import {spawn, spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, statSync, unlinkSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {PROJECTS, makeProject} from '../P-05-hosted-fit/gen-overlay.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const workerd = `${os.homedir()}/Work/isolate-factory-lab/adapters/executors/workerd/node_modules/@cloudflare/workerd-linux-64/bin/workerd`;
const save = (name,data) => writeFileSync(`${here}/receipt/${name}.json`, JSON.stringify(data,null,2));
const env = () => ({at:new Date().toISOString(),node:process.version,v8:process.versions.v8,kernel:os.release(),cpu:os.cpus()[0].model,cpuCount:os.cpus().length,load:os.loadavg(),free:os.freemem(),total:os.totalmem(),git:spawnSync('git',['rev-parse','HEAD'],{cwd:here}).stdout.toString().trim(),workerd:spawnSync(workerd,['--version']).stdout.toString().trim()});
function memory(pid) {
  const s=readFileSync(`/proc/${pid}/status`,'utf8');
  return Object.fromEntries(['VmRSS','VmHWM','RssAnon','RssFile'].map(k=>[k,Number(s.match(new RegExp(`^${k}:\\s+(\\d+)`,'m'))?.[1])*1024]));
}
const delay = ms => new Promise(r=>setTimeout(r,ms));
save('env-before',env());
for(const engine of process.argv.includes('--workerd-only') ? [] : ['old','new']) {
  const r=spawnSync(process.execPath,[`${here}/node-arm.mjs`,engine],{cwd:here,timeout:120000,encoding:'utf8'});
  save(`node-${engine}-process`,{status:r.status,signal:r.signal,error:String(r.error??''),stdout:r.stdout,stderr:r.stderr});
}
for (const engine of ['old','new']) {
  const wasm=`vendor/${engine}/${engine==='new'?'tsrs.wasm':'ts_rust.size.wasm'}`;
  const modules=[['worker.mjs','esModule','worker.mjs'],['check.mjs','esModule','check.mjs'],['old-host.mjs','esModule','old-host.mjs'],['core.js','esModule',`vendor/${engine}/core.js`],['compiler.wasm','wasm',wasm],['kernel.wasm','wasm','vendor/kernel.wasm']];
  const cfg=`using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [ (name = "shim", worker = .shim) ],
 sockets = [ (name = "http", address = "127.0.0.1:48519", http = (), service = "shim") ],
 v8Flags = ["--max-old-space-size=128"],
);
const shim :Workerd.Worker = (modules = [${modules.map(([n,t,p])=>`(name="${n}",${t}=embed "${p}")`).join(',')}], compatibilityDate = "2026-09-01");`;
  const cfgPath=`${here}/worker-${engine}.capnp`;
  writeFileSync(cfgPath,cfg);
  const out={engine,cells:{},controls:{},memory:{}};
  const child=spawn(workerd,['serve',cfgPath,'--experimental'],{cwd:here,stdio:['ignore','pipe','pipe']});
  let log=''; child.stdout.on('data',b=>log+=b); child.stderr.on('data',b=>log+=b);
  const check=async project=>{
    const t=performance.now();
    const r=await fetch('http://127.0.0.1:48519/check',{method:'POST',body:JSON.stringify({engine,project}),signal:AbortSignal.timeout(60000)});
    const j=await r.json(); if(!r.ok) throw new Error(JSON.stringify(j));
    return {...j,hostMs:performance.now()-t,process:memory(child.pid)};
  };
  try {
    const start=performance.now();
    while(true) {
      if(child.exitCode!==null) throw new Error(`startup exit ${child.exitCode}: ${log}`);
      try {if((await fetch('http://127.0.0.1:48519/ping')).ok) break;} catch{}
      if(performance.now()-start>15000) throw new Error('startup timeout');
      await delay(20);
    }
    out.startMs=performance.now()-start;out.memory.idle=memory(child.pid);
    out.cold=await check(PROJECTS.five());
    for(const name of engine==='old'?['five','fifty']:['fifty','five']) {
      const p=PROJECTS[name]();
      for(let i=0;i<3;i++) await check(p);
      out.cells[name]=[];
      for(let i=0;i<20;i++) out.cells[name].push(await check(p));
    }
    out.controls.clean=await check(makeProject(50,[]));
    out.memory.after=memory(child.pid);
  } catch(e) {out.error=String(e);out.stack=e.stack;}
  finally {
    if(child.exitCode===null) {child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(2000)]);if(child.exitCode===null) child.kill('SIGKILL');}
    out.log=log;save(`workerd-${engine}`,out);unlinkSync(cfgPath);
  }
}
const sizes={};
for(const engine of ['old','new']) {
  const paths=[`${here}/vendor/${engine}/${engine==='old'?'ts_rust.size.wasm':'tsrs.wasm'}`,`${here}/vendor/${engine}/core.js`];
  sizes[engine]=paths.map(p=>({file:p.split('/').slice(-2).join('/'),bytes:statSync(p).size,gzipBytes:gzipSync(readFileSync(p),{level:9}).length}));
}
save('sizes',sizes);save('env-after',env());
