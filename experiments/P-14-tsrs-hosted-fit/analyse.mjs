import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {PROJECTS} from '../P-05-hosted-fit/gen-overlay.mjs';
const load = n => JSON.parse(readFileSync(new URL(`./receipt/${n}.json`,import.meta.url)));
const stats = xs => {
  const s = [...xs].sort((a,b)=>a-b), n=s.length;
  return {n,median:(s[(n-1)>>1]+s[n>>1])/2,p95:s[Math.ceil(.95*n)-1],min:s[0],max:s[n-1]};
};
function expected(name) {
  const p=PROJECTS[name](), indices=name==='five'?[3]:[7,19,23,38,49];
  return indices.map(i=>{
    const symbol=`brokenm${String(i).padStart(2,'0')}`, file=`/proj/src/m${String(i).padStart(2,'0')}.ts`;
    const source=p.files[file], pos=source.indexOf(symbol), prefix=source.slice(0,pos);
    assert(pos>=0);
    return {file,line:prefix.split('\n').length,col:pos-prefix.lastIndexOf('\n'),pos,code:2322,category:1,text:"Type 'string' is not assignable to type 'number'."};
  });
}
const summary={arms:{},parity:{},notes:['Sequential shared-desktop probe; no campaign result.','Linear memory includes reserved stack; RSS is process-wide.','Node samples from first attempt; workerd from configuration repair attempt.']};
for(const runtime of ['node','workerd']) {
  for(const engine of ['old','new']) {
    const d=load(`${runtime}-${engine}`); assert(!d.error,d.error);
    const out={coldMs:d.cold.wallMs,cells:{}};
    for(const name of ['five','fifty']) {
      const v=d.cells[name]; assert.equal(v.length,20);
      for(const sample of [d.cold,...v].filter((_,i)=>i>0||name==='five')) {
        assert.equal(sample.exitCode,2);
        assert.deepEqual(sample.diagnostics,expected(name));
        assert.equal(sample.stderr,'');
      }
      out.cells[name]={wallMs:stats(v.map(x=>x.wallMs)),linearBytes:stats(v.map(x=>x.linearBytes))};
      if(runtime==='workerd') {
        out.cells[name].hostMs=stats(v.map(x=>x.hostMs));
        out.cells[name].rssBytes=stats(v.map(x=>x.process.VmRSS));
        out.cells[name].peakProcessRssBytes=Math.max(...v.map(x=>x.process.VmHWM));
      } else {
        out.cells[name].heapBytes=stats(v.map(x=>x.memory.heapUsed));
        out.cells[name].rssBytes=stats(v.map(x=>x.memory.rss));
        out.cells[name].peakProcessRssBytes=Math.max(...v.map(x=>x.memory.maxRssBytes));
      }
    }
    assert.equal(d.controls.clean.exitCode,0);assert.deepEqual(d.controls.clean.diagnostics,[]);
    if(runtime==='node') {
      const u=d.controls.utf16;assert.equal(u.exitCode,2);assert.equal(u.diagnostics.length,1);
      assert.equal(u.diagnostics[0].pos,32);assert.equal(u.diagnostics[0].col,33);assert.equal(u.diagnostics[0].code,2322);
      assert.equal(d.controls.emit.exitCode,0);assert.deepEqual(d.controls.emit.diagnostics,[]);
    }
    summary.arms[`${runtime}-${engine}`]=out;
  }
  summary.parity[runtime]='All 80 timed outputs match independent planted-error expectations; both clean controls pass.';
}
assert.deepEqual(load('node-old').controls.emit.written,load('node-new').controls.emit.written);
summary.parity.emit='Byte-identical tiny JavaScript output; not general emit parity.';
summary.parity.utf16='Both report UTF-16 offset 32 / column 33 after an astral character.';
for(const runtime of ['node','workerd']) for(const name of ['five','fifty']) {
  const a=summary.arms[`${runtime}-old`].cells[name],b=summary.arms[`${runtime}-new`].cells[name];
  b.speedup=a.wallMs.median/b.wallMs.median;
  b.linearMemoryRatio=b.linearBytes.median/a.linearBytes.median;
}
writeFileSync(new URL('./receipt/summary.json',import.meta.url),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
