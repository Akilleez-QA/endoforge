// Trusted request oracle, frozen before either model call. Independent host checks.
import fs from 'node:fs';
const valid = [-273.15,-273.149999,-100,-40,-0,0,0.1,20,37,100,999.999999,1000];
let seed=20261018; for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;valid.push(-273.15+(seed/2**32)*1273.15);}
const invalid=[-273.150001,1000.000001,-1e100,1e100,NaN,Infinity,-Infinity];
export function evaluate(wasm){const m=new WebAssembly.Module(fs.readFileSync(wasm));const inst=new WebAssembly.Instance(m,{env:{abort(){throw Error('abort')}}});const f=inst.exports.celsiusToFahrenheit;const cases=[];for(const c of valid){let got,err;try{got=f(c)}catch(e){err=String(e)}cases.push({input:c,expected:c*9/5+32,got,error:err,pass:!err&&Math.abs(got-(c*9/5+32))<=1e-9});}for(const c of invalid){let trapped=false;try{f(c)}catch{trapped=true}cases.push({input:String(c),refuse:true,pass:trapped});}return {passed:cases.every(x=>x.pass),cases};}
if(process.argv[2]) console.log(JSON.stringify(evaluate(process.argv[2]),null,2));
