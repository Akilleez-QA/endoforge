/** Historical structural checks; no hosted models, generated-code execution or prose judging. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const demand=(b,m)=>{if(!b)throw Error(m)};
class Reader{
 constructor(bytes){this.bytes=bytes;this.i=0;}
 byte(){demand(this.i<this.bytes.length,'truncated WASM');return this.bytes[this.i++];}
 uint(){let n=0,m=1;for(let i=0;i<5;i++){const b=this.byte();if(i===4)demand(b<16,'WASM integer overflow');n+=(b&127)*m;if(!(b&128))return n;m*=128;}throw Error('WASM integer too long');}
 count(){const n=this.uint();demand(n<=1000000,'WASM vector bound');return n;}
 name(){const n=this.uint();demand(this.i+n<=this.bytes.length,'WASM name bound');const v=new TextDecoder('utf8',{fatal:true}).decode(this.bytes.subarray(this.i,this.i+n));this.i+=n;return v;}
 types(){return Array.from({length:this.count()},()=>this.byte());}
 limits(){const flags=this.uint();demand(flags<=3,'unsupported WASM limits');this.uint();if(flags&1)this.uint();}
}
export function wasmSignatures(bytes){
 bytes=Uint8Array.from(bytes);demand(bytes.length<=32*1024*1024,'WASM source bound');demand(bytes.length>=8&&Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([0,97,115,109,1,0,0,0])),'WASM header');demand(WebAssembly.validate(bytes),'invalid WASM binary');
 const r=new Reader(bytes);r.i=8;const types=[],functions=[],exports=[];
 while(r.i<bytes.length){const kind=r.byte(),size=r.uint(),end=r.i+size;demand(end<=bytes.length,'WASM section bound');
  if(kind===1){for(let n=r.count();n>0;n--){demand(r.byte()===96,'unsupported WASM type');types.push({params:r.types(),results:r.types()});}}
  else if(kind===2){for(let n=r.count();n>0;n--){r.name();r.name();const k=r.byte();if(k===0)functions.push(r.uint());else if(k===1){r.byte();r.limits();}else if(k===2)r.limits();else if(k===3){r.byte();r.byte();}else if(k===4){r.byte();r.uint();}else throw Error('unsupported WASM import kind');}}
  else if(kind===3){for(let n=r.count();n>0;n--)functions.push(r.uint());}
  else if(kind===7){for(let n=r.count();n>0;n--){const name=r.name(),k=r.byte(),index=r.uint();if(k===0)exports.push({name,index});}}
  demand(r.i<=end,'WASM section decoding overrun');r.i=end;
 }
 return Object.fromEntries(exports.map(e=>{const t=types[functions[e.index]];demand(t,'WASM function type absent');return[e.name,t];}));
}
function exported(glue,route){const names=Array.isArray(route.export)?route.export:[route.export];return(glue.exports??[]).find(e=>names.includes(e.name));}
export function checkHistoricalAssertion(assertion,artifact,arm){
 demand(assertion?.version===1&&typeof assertion.id==='string','assertion schema');const route=assertion.routes?.[arm];demand(route&&typeof route==='object','explicit arm route required');const results={version:1,assertionId:assertion.id,requestId:assertion.requestId,arm,kind:assertion.kind,semanticRole:assertion.semanticRole??null,scope:assertion.scope??'structural-subassertion'};
 const e=exported(artifact.glue,route),s=e?artifact.signatures[e.name]:null;const fail=reason=>({...results,passed:false,reason});
 if(!e)return fail('Declared semantic export absent');if(!s)return fail('Glue export not present in WASM binary');
 const kindTypes={number:[125,124],code:[127],boolean:[127],integer:[127,126,125,124]};
 const args=e.args??[];const binding=args.every(a=>typeof a.name==='string'&&a.name.length&&typeof a.unit==='string'&&a.unit.length&&['number','code','integer','boolean'].includes(a.kind))&&new Set(args.map(a=>a.name)).size===args.length&&['number','code','integer','boolean'].includes(e.result?.kind)&&typeof e.result?.unit==='string'&&e.result.unit.length&&args.length===s.params.length&&s.results.length===1&&s.params.every((t,i)=>kindTypes[args[i]?.kind]?.includes(t))&&kindTypes[e.result?.kind]?.includes(s.results[0]);
 if(assertion.kind==='binding')return{...results,passed:binding,export:e.name,observed:{glueArity:args.length,wasmArity:s.params.length,params:s.params,results:s.results,integerEncodingPolicy:'Declared integer may use float ABI; static check does not prove integral-value guards.'},reason:binding?'Declared numeric interface bound to actual WASM function':'Declared interface and actual WASM type differ'};
 if(!binding)return fail('Cannot bind metadata to actual numeric WASM interface');
 if(assertion.kind==='required-input'||assertion.kind==='argument-unit'){
  demand(Array.isArray(route.names)&&route.names.length>0,'explicit argument aliases required');const index=args.findIndex(a=>route.names.includes(a.name));
  if(index<0)return fail('Decision-relevant input path absent from this exported computation');const a=args[index];
  const unitOk=!route.units||route.units.includes(a.unit);const kindOk=!route.kinds||route.kinds.includes(a.kind);return{...results,passed:unitOk&&kindOk,export:e.name,observed:{argument:a.name,index,kind:a.kind,unit:a.unit,wasmType:s.params[index]},reason:unitOk&&kindOk?'Explicit argument path and declared quantity matched':'Input quantity or kind differs from explicit requirement'};
 }
 if(assertion.kind==='output-unit'){demand(Array.isArray(route.units),'explicit output units required');return{...results,passed:route.units.includes(e.result?.unit),export:e.name,observed:e.result??null,reason:'Checks declared output quantity only; numeric correctness is a separate procedure'};}
 if(assertion.kind==='precision'){demand(Number.isInteger(route.minimumDecimals),'precision threshold');const precision=e.result?.precision;return{...results,passed:Number.isInteger(precision)&&precision>=route.minimumDecimals,export:e.name,observed:precision??null,reason:'Checks declared rendering precision only; numeric accuracy remains separate'};}
 if(assertion.kind==='trap-binding'){const rows=(artifact.glue.traps??[]).filter(t=>t.fn===e.name);const valid=rows.some(t=>typeof t.when==='string'&&t.when.trim()&&typeof t.message==='string'&&t.message.trim());return{...results,passed:valid,export:e.name,observed:rows,reason:'Only checks nonempty refusal metadata attached to actual export; does not infer message semantics or actual trap behavior'};}
 throw Error('unsupported historical assertion kind');
}
export function loadHistoricalArtifact(root,relative){const dir=path.resolve(root,relative);demand(dir.startsWith(path.resolve(root)+path.sep),'artifact outside repository');const sources={};for(const name of ['glue.json','kernel.wasm','CONTRACT.md']){const p=path.join(dir,name);if(fs.existsSync(p)){demand(!fs.lstatSync(p).isSymbolicLink(),'symlink artifact');sources[path.relative(root,p)]=sha(fs.readFileSync(p));}}
 const glue=JSON.parse(fs.readFileSync(path.join(dir,'glue.json'))),bytes=fs.readFileSync(path.join(dir,'kernel.wasm'));return{glue,signatures:wasmSignatures(bytes),sources};}
export function replayHistoricalAssertions(root,inventory,assertions){const rows=[],sources={};for(const pair of inventory)for(const arm of ['incumbent','fast-path']){let artifact,error;try{artifact=loadHistoricalArtifact(root,pair[arm].path);Object.assign(sources,artifact.sources);}catch(e){error=e.message;}for(const assertion of assertions.filter(a=>a.requestId===pair.requestId&&(!a.onlyArm||a.onlyArm===arm))){if(error)rows.push({version:1,assertionId:assertion.id,requestId:pair.requestId,arm,passed:false,reason:'Artifact unavailable: '+error});else rows.push(checkHistoricalAssertion(assertion,artifact,arm));}}return{version:1,rows,sources};}
function selftest(){const type=[96,2,124,124,1,124],body=[0,68,0,0,0,0,0,0,0,0,11];const section=(id,x)=>[id,x.length,...x];const bytes=Buffer.from([0,97,115,109,1,0,0,0,...section(1,[1,...type]),...section(3,[1,0]),...section(7,[1,1,102,0,0]),...section(10,[1,body.length,...body])]);const artifact={glue:{exports:[{name:'f',args:[{name:'flow',kind:'number',unit:'kg/s'},{name:'load',kind:'number',unit:'kg/s'}],result:{kind:'number',unit:'dimensionless',precision:2}}],traps:[{fn:'f',when:'load is zero',message:'Supply positive load'}]},signatures:wasmSignatures(bytes)};const checks=[];const check=(kind,extra,mutate)=>{const assertion={version:1,id:'control-'+kind,kind,requestId:'control',routes:{incumbent:{export:'f',...extra}}};const good=checkHistoricalAssertion(assertion,artifact,'incumbent');const bad=structuredClone(artifact);mutate(bad);const negative=checkHistoricalAssertion(assertion,bad,'incumbent');demand(good.passed&&!negative.passed,'control failure '+kind);checks.push({kind,positive:good,negative});};check('binding',{},a=>a.glue.exports[0].args.pop());check('binding',{},a=>{const changed=Buffer.from(bytes);changed[13]=127;a.signatures=wasmSignatures(changed);});check('binding',{},a=>{const changed=Buffer.from([0,97,115,109,1,0,0,0,...section(1,[1,96,2,124,124,1,127]),...section(3,[1,0]),...section(7,[1,1,102,0,0]),...section(10,[1,4,0,65,0,11])]);a.signatures=wasmSignatures(changed);});check('binding',{},a=>a.glue.exports[0].args[0].kind='string');check('binding',{},a=>a.glue.exports[0].result.kind='object');check('required-input',{names:['flow'],units:['kg/s']},a=>a.glue.exports[0].args[0].name='unrelated');check('argument-unit',{names:['flow'],units:['kg/s']},a=>a.glue.exports[0].args[0].unit='kWh');check('output-unit',{units:['dimensionless']},a=>a.glue.exports[0].result.unit='kg');check('precision',{minimumDecimals:2},a=>a.glue.exports[0].result.precision=0);check('trap-binding',{},a=>a.glue.traps[0].fn='absentExport');let invalid=false;try{wasmSignatures(Buffer.from([0,1,2]));}catch{invalid=true;}demand(invalid,'invalid WASM control');return{version:1,passed:true,checks,malformedWasmRejected:true,execution:'No WASM instantiation or calls; binary signatures inspected only.'};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const cmd=process.argv[2];if(cmd==='selftest')console.log(JSON.stringify(selftest(),null,2));else if(cmd==='replay'){const root=path.resolve(process.argv[3]),inventory=JSON.parse(fs.readFileSync(process.argv[4])),assertions=JSON.parse(fs.readFileSync(process.argv[5]));console.log(JSON.stringify(replayHistoricalAssertions(root,inventory,assertions),null,2));}else throw Error('selftest | replay repo inventory.json assertions.json');}catch(e){console.error(JSON.stringify({passed:false,error:e.message}));process.exitCode=1;}}
