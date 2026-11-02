#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { candidate } from './candidate.mjs';
writeFileSync(process.argv[process.argv.indexOf('-o') + 1], Buffer.from(candidate().compiled.wasm, 'base64'));
