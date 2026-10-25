#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor/new vendor/old
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
npm pack @tsrs/wasm@0.18.0-ts7.1.0-dev.20260929 --ignore-scripts --json --pack-destination "$scratch" > "$scratch/pack.json"
node --input-type=module - "$scratch" <<'JS'
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=process.argv[2], meta=Object.values(JSON.parse(readFileSync(`${dir}/pack.json`)))[0];
const expected=Object.values(JSON.parse(readFileSync('receipt/npm-pack.json')))[0];
const actual='sha512-'+createHash('sha512').update(readFileSync(`${dir}/${meta.filename}`)).digest('base64');
if(actual!==expected.integrity) throw new Error('npm tarball integrity mismatch');
JS
tar -xzf "$scratch/tsrs-wasm-0.18.0-ts7.1.0-dev.20260929.tgz" -C "$scratch"
cp "$scratch/package/core.js" "$scratch/package/tsrs.wasm" vendor/new/
baseline="$HOME/Work/isolate-factory-lab/adapters/checkers/tscrs-wasm/vendor"
cp "$baseline/core.js" "$baseline/ts_rust.size.wasm" vendor/old/
cp ../P-05-hosted-fit/worker/kernel.wasm vendor/
sha256sum -c receipt/artifacts.sha256
