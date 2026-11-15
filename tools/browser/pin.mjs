export const KITESURF_COMMIT = '4a29038';
export const KITESURF_ARTIFACT = Object.freeze({
  file: 'endoforge-kitesurf-core-4a29038.tar.gz',
  sha256: 'fb5bb500196a52ba663e2eb3aba291958e6d77a590ad28ec3c9016ff94843b63',
});
export const KITESURF_CORE = Object.freeze({
  name: 'kitesurf-core-4a29038',
  sha256: '6c13fba66edd4cabd5fb439a347f11baccc8bef9b62519127ab1572a93db11d2',
  maximumPages: 4096,
});
export const WORKCELL = Object.freeze({
  wasmMemoryMaxMb: 256,
  toolingWasmModules: Object.freeze([KITESURF_CORE]),
});
