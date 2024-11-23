import {
  createPointer,
  DataType,
  FFIParams,
  FieldType,
  freePointer,
  funcConstructor,
  load,
  open,
  PointerType,
  unwrapPointer,
} from 'node-ffi-rs';

function openUser32() {
  open({
    library: 'user32',
    path: 'user32.dll',
  });
}

openUser32();

async function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function loadUser32<
  T extends FieldType,
  U extends boolean | undefined = undefined,
  RunInNewThread extends boolean | undefined = undefined,
>(
  params: Omit<FFIParams<T, U, RunInNewThread>, 'library' | 'runInNewThread'>,
): Promise<any> {
  return load({
    library: 'user32',
    runInNewThread: true,
    ...params,
  });
}

function findWorkerWByProgman(progman: number) {
  return loadUser32({
    funcName: 'FindWindowExA',
    retType: DataType.I32,
    paramsType: [DataType.I32, DataType.I32, DataType.String, DataType.Void],
    paramsValue: [progman, 0, 'WorkerW', null],
  });
}

function findSHELLDLL_DefView(hwnd: number) {
  return loadUser32({
    funcName: 'FindWindowExA',
    retType: DataType.I32,
    paramsType: [DataType.I32, DataType.Void, DataType.String, DataType.Void],
    paramsValue: [hwnd, null, 'SHELLDLL_DefView', null],
  });
}

async function findProgman() {
  return await loadUser32({
    funcName: 'FindWindowA',
    retType: DataType.I32,
    paramsType: [DataType.String, DataType.Void],
    paramsValue: ['Progman', null],
  });
}

async function getWorkerW(progman: number) {
  const winHandlers: number[] = [];
  const enumFunc = (hwnd: number, lParam: any) => {
    winHandlers.push(hwnd);
    return true;
  };

  const enumFuncArgs = {
    paramsType: [
      funcConstructor({
        paramsType: [DataType.I32],
        retType: DataType.Boolean,
      }),
    ],
    paramsValue: [enumFunc],
  };
  const enumFuncExternal = createPointer(enumFuncArgs);

  await loadUser32({
    funcName: 'EnumWindows',
    retType: DataType.Void,
    paramsType: [DataType.External],
    paramsValue: unwrapPointer(enumFuncExternal),
  });

  freePointer({
    paramsType: [
      funcConstructor({
        paramsType: [DataType.I32],
        retType: DataType.I32,
      }),
    ],
    paramsValue: enumFuncExternal,
    pointerType: PointerType.RsPointer,
  });

  let workerW = 0;
  for (const winHandler of winHandlers) {
    const SHELLDLL_DefView = await findSHELLDLL_DefView(winHandler);

    if (!SHELLDLL_DefView) continue;
    workerW = await loadUser32({
      funcName: 'FindWindowExA',
      retType: DataType.I32,
      paramsType: [DataType.Void, DataType.I32, DataType.String, DataType.Void],
      paramsValue: [null, winHandler, 'WorkerW', null],
    });
  }

  if (workerW) {
    return workerW;
  }

  let count = 0;
  while (!workerW && count < 10) {
    workerW = await findWorkerWByProgman(progman);
    count++;
    await delay(100);
  }

  return workerW;
}

export async function attach(win: number) {
  const progman = await findProgman();

  await loadUser32({
    funcName: 'PostMessageW',
    retType: DataType.I32,
    paramsType: [DataType.I32, DataType.I32, DataType.I32, DataType.I32],
    paramsValue: [progman, 0x052c, 0xd, 0x1],
  });

  const workerW = await getWorkerW(progman);

  const result = load({
    library: 'user32',
    funcName: 'SetParent',
    retType: DataType.I32,
    paramsType: [DataType.I32, DataType.I32],
    paramsValue: [win, workerW],
  });

  console.log(await refreshDesktop());

  return result;
}

export async function detach(win: number) {
  return load({
    library: 'user32',
    funcName: 'SetParent',
    retType: DataType.I32,
    paramsType: [DataType.I32, DataType.Void],
    paramsValue: [win, null],
  });
}

export async function refresh() {
  return loadUser32({
    funcName: 'SystemParametersInfoW',
    retType: DataType.I32,
    paramsType: [DataType.I32, DataType.I32, DataType.Void, DataType.I32],
    paramsValue: [0, 0x0014, null, 0x02],
  });
}

export async function refreshDesktop() {
  const progman = await findProgman();

  const SHELLDLL_DefView = await findSHELLDLL_DefView(progman);

  const invalidateReactResult = await loadUser32({
    funcName: 'InvalidateRect',
    retType: DataType.Boolean,
    paramsType: [DataType.I32, DataType.Void, DataType.Boolean],
    paramsValue: [SHELLDLL_DefView, null, true],
  });

  const updateWindowResult = await loadUser32({
    funcName: 'UpdateWindow',
    retType: DataType.Boolean,
    paramsType: [DataType.I32],
    paramsValue: [SHELLDLL_DefView],
  });

  return {
    invalidateReactResult,
    updateWindowResult,
  };
}
