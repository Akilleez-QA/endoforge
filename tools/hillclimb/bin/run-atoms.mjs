#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scheduleArgv } from '../lib/runner.mjs';

const SCHEDULER = fileURLToPath(new URL('../../atomizer/bin/schedule.mjs', import.meta.url));
const argv = scheduleArgv(process.argv.slice(2), SCHEDULER);
if (!argv) { console.error('usage: run-atoms.mjs <atoms.json> --out <dir> [--concurrency N] [--timeout S] [--policy file]'); process.exit(2); }
const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit' });
process.exit(r.status ?? 1);
