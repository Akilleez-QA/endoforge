import { fileURLToPath } from 'node:url';
import { trustedWasmModules } from '../../experiments/assemblyscript-toolchain.mjs';

export const ASC_VERSION = '0.28.20';
export const ASC_PATH = fileURLToPath(new URL('node_modules/assemblyscript/dist/asc.js', import.meta.url));
export const ASC_FILES = Object.freeze({
  'assemblyscript/dist/asc.js': 'ebce85ca33b6e2d901ad2f9fe2daf4f98a42217a0bcbbb40fd98991ababd3891',
  'assemblyscript/dist/assemblyscript.js': 'b0ea444edfff355fe2981451358c5b8b24996f5e9190e02bceae60c94adeea19',
  'binaryen/index.js': '08e348487a67b24351d5ff81ae707e051b5d213bd359d84ad90c789f3793001a',
  'long/index.js': '8d6b1d2162ff21170db73d6b91e313e6b90bd35acfdd60453b2792ec433ae69e',
});
export const WORKCELL = Object.freeze({
  wasmMemoryMaxMb: 4096,
  resourceLimits: Object.freeze({ maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 32 }),
  trustedWasmModules,
});
