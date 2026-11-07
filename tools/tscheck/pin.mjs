import { fileURLToPath } from 'node:url';

export const TSRS_VERSION = '0.22.0-ts7.1.0-beta';
export const TSRS_CORE_SHA256 = 'c837154b59a98a595120ea5018e6efbe9cf10a2df2d2f74f96abc2a55b5db760';
export const TSRS_MODULE = Object.freeze({
  name: 'tsrs-0.22.0-ts7.1.0-beta',
  sha256: '264cd33dff02453c5c8d91ad57a7269bec700a3645b4d6a53b9ea1e8add114e5',
  maximumPages: 16384,
});
export const WORKCELL = Object.freeze({
  wasmMemoryMaxMb: 1024,
  resourceLimits: Object.freeze({ maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32, stackSizeMb: 256 }),
  trustedWasmModules: Object.freeze([TSRS_MODULE]),
  sharedWasmModules: Object.freeze([Object.freeze({ sha256: TSRS_MODULE.sha256, path: fileURLToPath(new URL('node_modules/@tsrs/wasm/tsrs.wasm', import.meta.url)) })]),
});
