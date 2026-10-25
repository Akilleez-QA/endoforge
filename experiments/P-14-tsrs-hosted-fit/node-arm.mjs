import {readFileSync, writeFileSync} from 'node:fs';
import {check} from './check.mjs';
import {PROJECTS, makeProject} from '../P-05-hosted-fit/gen-overlay.mjs';
const engine = process.argv[2];
const base = new URL(`./vendor/${engine}/`, import.meta.url);
const core = await import(new URL('core.js', base));
const t = performance.now();
const module = new WebAssembly.Module(readFileSync(new URL(engine === 'new' ? 'tsrs.wasm' : 'ts_rust.size.wasm', base)));
const compileMs = performance.now() - t;
const kernel = new WebAssembly.Module(readFileSync(new URL('./vendor/kernel.wasm', import.meta.url)));
const mem = () => ({...process.memoryUsage(), maxRssBytes: process.resourceUsage().maxRSS * 1024});
const out = {engine, compileMs, before: mem(), cold: null, cells: {}, controls: {}};
const one = p => ({...check(engine, core, module, kernel, p), memory: mem()});
try {
  out.cold = one(PROJECTS.five());
  for (const name of engine === 'old' ? ['five','fifty'] : ['fifty','five']) {
    const p = PROJECTS[name]();
    for (let i=0;i<3;i++) one(p);
    out.cells[name] = [];
    for (let i=0;i<20;i++) out.cells[name].push(one(p));
  }
  out.controls.clean = one(makeProject(50, []));
  for (const [name, source, emit] of [['utf16', 'export const face = "😀"; const bad: number = "wrong";', false], ['emit', 'export function add(a: number, b: number): number { return a + b; }', true]]) {
    out.controls[name] = one({root:'/proj', files:{'/proj/a.ts':source, '/proj/tsconfig.json':JSON.stringify({compilerOptions:{strict:true,target:'es2022',module:'esnext',types:[],skipLibCheck:true,noEmit:!emit},files:['a.ts']})}});
  }
} catch(e) { out.error = String(e); out.stack = e.stack; }
out.after = mem();
writeFileSync(new URL(`./receipt/node-${engine}.json`, import.meta.url), JSON.stringify(out,null,2));
if(out.error) process.exitCode=1;
