import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { ARTIFACT_DIR, ARTIFACT_ROOT, RELEASE_URL, sha256, verifyArtifact } from './artifact.mjs';
import { KITESURF_ARTIFACT } from './pin.mjs';

const tarball = `${ARTIFACT_ROOT}${KITESURF_ARTIFACT.file}`;
const staging = `${ARTIFACT_ROOT}.staging-${process.pid}/`;
const verifiedTarball = () => existsSync(tarball) && sha256(readFileSync(tarball)) === KITESURF_ARTIFACT.sha256;

async function download() {
  const response = await fetch(RELEASE_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== KITESURF_ARTIFACT.sha256) throw new Error('downloaded tarball digest does not match the pin');
  writeFileSync(`${tarball}.part`, bytes);
  renameSync(`${tarball}.part`, tarball);
}

function extract() {
  mkdirSync(staging);
  execFileSync('tar', ['-xzf', tarball, '-C', staging, '--no-same-owner', '--no-same-permissions'], { stdio: 'ignore' });
  const extracted = `${staging}${ARTIFACT_DIR.slice(ARTIFACT_ROOT.length)}`;
  const result = verifyArtifact(extracted);
  if (result.status !== 'ready') throw new Error(`extracted artifact refused: ${result.reason}`);
  renameSync(extracted, ARTIFACT_DIR);
}

try {
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  if (verifyArtifact().status === 'ready' && verifiedTarball()) console.log('kitesurf artifact ready');
  else {
    rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    if (!verifiedTarball()) {
      rmSync(tarball, { force: true });
      await download();
    }
    extract();
    console.log('kitesurf artifact installed and verified');
  }
} catch (error) {
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  console.log(`kitesurf artifact unavailable (${error.message}); browser tests will skip`);
} finally {
  rmSync(staging, { recursive: true, force: true });
  rmSync(`${tarball}.part`, { force: true });
}
