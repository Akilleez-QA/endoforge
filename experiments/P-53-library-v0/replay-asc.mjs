#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
writeFileSync(process.argv[process.argv.indexOf('-o') + 1], Buffer.from(readFileSync(process.env.P53_WASM, 'utf8'), 'base64'));
