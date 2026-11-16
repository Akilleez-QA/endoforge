import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KITESURF_ARTIFACT, KITESURF_COMMIT, KITESURF_CORE } from './pin.mjs';

export const RELEASE_URL = `https://github.com/Akilleez-QA/endoforge/releases/download/kitesurf-core-${KITESURF_COMMIT}/${KITESURF_ARTIFACT.file}`;
export const ARTIFACT_ROOT = fileURLToPath(new URL('.artifact/', import.meta.url));
export const ARTIFACT_DIR = `${ARTIFACT_ROOT}endoforge-kitesurf-core-${KITESURF_COMMIT}/`;
export const FILES = Object.freeze({
  wasm: ['kitesurf_core_bg.wasm', KITESURF_CORE.sha256],
  glue: ['kitesurf_core.js', 'b26d44954abebf27b7f438ff3cf3a75997aa848a67e891fed68f2a028894a5bd'],
  sans: ['fonts/NotoSans.ttf', 'fe82378eac7d78aedd01642a4442f681b3d173b87eaaf5bbd3238eb10f67664a'],
  sansItalic: ['fonts/NotoSans-Italic.ttf', '235588d834d5434e6e0076b9e51c17a05704419c9e03e95d3f39edcdeb2c8247'],
  serif: ['fonts/NotoSerif.ttf', 'd4ec826f378beae5379368155d6677fc6d9efdb04dcd364deb8538e42cdb5174'],
  mono: ['fonts/NotoSansMono.ttf', '06d85d79da70d4e19e0eca1149eaf0cc1e53952ea876f0d519f57550f0b20b84'],
});

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyArtifact(dir = ARTIFACT_DIR) {
  const bytes = {};
  for (const [key, [file, digest]] of Object.entries(FILES)) {
    const path = `${dir}${file}`;
    if (!existsSync(path)) return { status: 'skip', reason: `missing ${file}` };
    bytes[key] = readFileSync(path);
    if (sha256(bytes[key]) !== digest) return { status: 'skip', reason: `digest mismatch for ${file}` };
  }
  return { status: 'ready', bytes };
}
