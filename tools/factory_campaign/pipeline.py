"""A small explicit factory manifest: independent evals -> freeze -> maker -> bounds -> gates."""
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import shlex
import subprocess
import time
import uuid
import copy

from tools.factory_campaign.control import digest
from tools.factory_campaign.models import run_model, strip_fences
from tools.factory_runtime.runner import capture_attempt, run_attempt
from tools.factory_runtime import wasm
from tools.factory_runtime.core import valid_id
from tools.factory_campaign import state as durable_state

REPO=Path(__file__).resolve().parents[2]
Q=REPO/'tools/factory_quality/cli.mjs'
NODE=Path(subprocess.check_output(['which','node'],text=True).strip()).resolve()
IMAGE_GATE='/bundle/campaigns/x1-spec-study/factory/gate.mjs'


def canonical(obj):return json.dumps(obj,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n'
def write(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True)
    if p.name=='state.json':durable_state.record(p.parent,obj)
    else:durable_state.atomic(p,obj)


def quality(command,*args,check=True):
    r=subprocess.run([str(NODE),str(Q),command,*map(str,args)],capture_output=True,text=True,timeout=15)
    if r.returncode and check:raise RuntimeError(r.stderr or r.stdout)
    try:return json.loads(r.stdout)
    except json.JSONDecodeError:raise RuntimeError(r.stderr)


def mandatory_cases(signature):
    """Domain/finite refusals are deterministic host rules, never model memory."""
    if len(signature['inputs'])!=1 or signature['inputs'][0]['type']!='number':raise ValueError('numeric backend scope')
    arg=signature['inputs'][0];key=arg['path'];lo,hi=arg['domain']
    def outside(endpoint,direction):
        value=math.nextafter(endpoint,direction)
        return value if math.isfinite(value) else ('Infinity' if value>0 else '-Infinity')
    values=[('nan','NaN'),('positive-infinity','Infinity'),('negative-infinity','-Infinity'),('below-domain',outside(lo,-math.inf)),('above-domain',outside(hi,math.inf))]
    cases=[{'id':'host-validity-'+name,'inputs':{key:value},'expectError':True,'errorPath':key,'tolerance':0,'unit':signature['output']['unit']}for name,value in values]
    cases.append({'id':'host-validity-missing','inputs':{},'expectError':True,'errorPath':key,'tolerance':0,'unit':signature['output']['unit']})
    return cases


def prepare(jobdir,request,signature,bundle):
    """Freeze immutable requirements before a generator is called."""
    if bundle.get('request')!=request or bundle.get('signature')!=signature:
        raise ValueError('job request/signature must exactly match the independent eval bundle')
    if not valid_id(request.get('id')):raise ValueError('unsafe request identifier')
    if request.get('artifactClass')!='closed-form' or len(signature.get('inputs',[]))!=1 or signature['inputs'][0].get('type')!='number' or signature.get('output',{}).get('type')!='number':
        raise ValueError('unsupported by this qualified numeric backend; retain request in unsupported stratum')
    jobdir=Path(jobdir);jobdir.mkdir(parents=True,exist_ok=False)
    write(jobdir/'request.json',request);write(jobdir/'signature.json',signature)
    quality('validate','request',jobdir/'request.json');quality('validate','signature',jobdir/'signature.json')
    bundle=copy.deepcopy(bundle);host_cases=mandatory_cases(signature);bundle['cases']=[*bundle.get('cases',[]),*host_cases]
    write(jobdir/'host-validity-rules.json',{'version':1,'source':'typed request finite domains; independent deterministic rule set','implementationSha256':digest(Path(__file__)),'cases':host_cases})
    write(jobdir/'eval-bundle.json',bundle)
    frozen=quality('freeze',jobdir/'eval-bundle.json',jobdir/'frozen.json')
    cases=quality('cases',jobdir/'frozen.json')
    # No hidden assumption; the request text and typed signature form the host contract.
    contract=request['raw']+'\n\nBare signature: '+canonical(signature)
    tests=[]
    for c in cases:
        args=[c['inputs'].get(a['path'],'NaN') for a in signature['inputs']]
        t={'name':c['id'],'fn':signature['name'],'args':args}
        if c.get('expectError'):t['expectError']=True
        else:
            if 'expect' not in c:raise ValueError('reference cases need resolved project provider before execution')
            t.update(expect=c['expect'],tol=c['tolerance'])
        tests.append(t)
    files={'CONTRACT.md':contract,'tests.json':canonical(tests)}
    files['frozen.sha256']=canonical({'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'contract':hashlib.sha256(contract.encode()).hexdigest(),'tests':hashlib.sha256(files['tests.json'].encode()).hexdigest()})
    write(jobdir/'frozen-files.json',files)
    write(jobdir/'state.json',{'version':1,'job':request['id'],'stage':'frozen','frozenHash':digest(jobdir/'frozen.json'),'generatorStarted':False,'completedStages':['intake','paired-evals','freeze'],'pendingStages':['generate','compile','bounded-evals','trusted-gates','publish']})
    return frozen,cases


def maker_prompt(request,signature):
    return ('Write only AssemblyScript source, no fences or explanation. Pure exported numeric function(s), no imports, I/O, globals or side effects. Use f64 inputs and f64 output. Refuse every nonfinite or out-of-domain input with unreachable(). Follow the explicit request exactly. Do not invent defaults. You have no evaluator tests.\nREQUEST\n'+request['raw']+'\nBARE SIGNATURE\n'+canonical(signature))


def add_candidate(jobdir,code):
    jobdir=Path(jobdir);request=json.loads((jobdir/'request.json').read_text());signature=json.loads((jobdir/'signature.json').read_text())
    files=json.loads((jobdir/'frozen-files.json').read_text())
    files['kernel.ts']=strip_fences(code)+'\n'
    files['glue.json']=canonical({'id':request['id'],'assumption':'Only the explicit request and typed inputs; no additional defaults.','question':'Provide all declared required inputs.','exports':[{'name':signature['name'],'label':signature['name'],'args':[{'name':a['path'],'kind':'number','unit':a['unit']} for a in signature['inputs']],'result':{'kind':'number','unit':signature['output']['unit'],'precision':6}}],'traps':[{'fn':signature['name'],'when':'Missing, nonfinite or outside the declared input domain','message':'Supply every named argument within its finite declared domain.'}]})
    payload={'version':1,'job':request['id'],'signature':signature,'files':files,'frozenEvalSha256':digest(jobdir/'frozen.json')}
    path=jobdir/'capability.json';path.write_text(canonical(payload))
    write(jobdir/'state.json',{'version':1,'job':request['id'],'stage':'generated','frozenHash':digest(jobdir/'frozen.json'),'candidateHash':digest(path),'generatorStarted':True,'completedStages':['intake','paired-evals','freeze','generate'],'pendingStages':['compile','bounded-evals','trusted-gates','publish']})
    return path


def _script(mode):
    # The script is trusted and versioned; only JSON data is supplied by the maker.
    js="""const fs=require('fs'),cp=require('child_process'),p=JSON.parse(fs.readFileSync('/input.txt','utf8'));
if(p.version!==1||!/^[-A-Za-z0-9_]{1,80}$/.test(p.job))throw Error('payload');
const names=['CONTRACT.md','tests.json','frozen.sha256','kernel.ts','glue.json'];
if(Object.keys(p.files).sort().join()!=names.sort().join())throw Error('file set');
const d='/tmp/'+p.job;fs.mkdirSync(d);for(const n of names){if(typeof p.files[n]!=='string')throw Error('file content');fs.writeFileSync(d+'/'+n,p.files[n]);}
"""
    if mode=='compile':
        js+="""cp.execFileSync('/usr/local/bin/node',['/bundle/experiments/P-02-compiler-in-isolate/node_modules/assemblyscript/bin/asc.js',d+'/kernel.ts','--runtime','stub','-O3','--noAssert','-o',d+'/kernel.wasm'],{timeout:60000,stdio:['ignore','pipe','pipe']});
const b=fs.readFileSync(d+'/kernel.wasm'),m=new WebAssembly.Module(b);if(WebAssembly.Module.imports(m).length)throw Error('imports denied');
process.stdout.write(b.toString('base64')+'\\n');"""
    elif mode=='gate':
        js+="""const r=cp.spawnSync('/usr/local/bin/node',['/bundle/campaigns/x1-spec-study/factory/gate.mjs','run',d],{timeout:60000,encoding:'utf8'});process.stderr.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.status!==0)process.exit(r.status||1);process.stdout.write(fs.readFileSync('/input.txt','utf8'));"""
    else:raise ValueError('mode')
    return 'exec /usr/local/bin/node -e '+shlex.quote(js)


def compile_candidate(root,jobdir,attempt=None):
    jobdir=Path(jobdir);payload=jobdir/'capability.json';data=json.loads(payload.read_text())
    result=capture_attempt(Path(root)/'runtime',attempt or 'compile-'+uuid.uuid4().hex[:12],data['job'],payload,digest(payload),_script('compile'),timeout=75)
    write(jobdir/'compile-receipt.json',result)
    if result.get('outcome')!='captured':raise RuntimeError('compile failed; see receipt')
    raw=Path(result['stdoutPath']).read_text().strip();module=base64.b64decode(raw,validate=True)
    if module[:8]!=b'\0asm\x01\0\0\0' or len(module)>1048576:raise ValueError('invalid WASM capture')
    (jobdir/'kernel.wasm').write_bytes(module)
    return jobdir/'kernel.wasm'


def invoke_cases(jobdir,module=None):
    jobdir=Path(jobdir);module=module or jobdir/'kernel.wasm';signature=json.loads((jobdir/'signature.json').read_text());cases=quality('cases',jobdir/'frozen.json')
    outputs=[];raw=[]
    for c in cases:
        args=[]
        for a in signature['inputs']:
            value=c['inputs'].get(a['path'],'NaN')
            args.append({'NaN':'nan','Infinity':'inf','-Infinity':'-inf'}.get(str(value),str(value)))
        r=wasm.run(module,export=signature['name'],fuel=100000,memory=1048576,epoch='100ms',wall=2,args=args)
        raw.append({'caseId':c['id'],**r})
        if r['exit']!=0:
            # Only the kernel's explicit unreachable refusal is a semantic error.
            # Fuel, timeout, memory, missing export and runtime failures must fail evals.
            semantic_refusal=(not r.get('wallTimeout') and 'wasm trap: wasm `unreachable` instruction executed' in r['stderr']
                              and not any(s in r['stderr'].lower() for s in ['fuel','interrupt','out of bounds','allocation','memory size']))
            outputs.append({'caseId':c['id'],'error':{'path':c.get('errorPath',signature['inputs'][0]['path']) if semantic_refusal else '__runtime_failure__','kind':'refusal' if semantic_refusal else 'runtime-failure'}})
        else:
            try:v=float(r['stdout'].strip().splitlines()[-1])
            except (ValueError,IndexError):v=None
            outputs.append({'caseId':c['id'],'value':v if v is not None and math.isfinite(v) else None,'unit':signature['output']['unit']})
    candidate={'signature':signature,'outputs':outputs};write(jobdir/'executed-candidate.json',candidate);write(jobdir/'bounded-execution.json',raw)
    verdict=quality('check',jobdir/'frozen.json',jobdir/'executed-candidate.json',check=False)
    write(jobdir/'quality-receipt.json',verdict)
    return verdict


def verify_publish(root,jobdir,attempt=None):
    jobdir=Path(jobdir);payload=jobdir/'capability.json';p=json.loads(payload.read_text())
    signature=json.loads((jobdir/'signature.json').read_text());state=durable_state.recover(jobdir)
    request=json.loads((jobdir/'request.json').read_text());frozen=json.loads((jobdir/'frozen.json').read_text())
    if p.get('job')!=request['id'] or frozen['suite']['request']!=request or frozen['suite']['signature']!=signature:
        raise ValueError('normative request/signature binding mismatch')
    frozen_files=json.loads((jobdir/'frozen-files.json').read_text())
    if p['signature']!=signature or p['frozenEvalSha256']!=digest(jobdir/'frozen.json') or state['frozenHash']!=digest(jobdir/'frozen.json'):
        raise ValueError('candidate/frozen signature identity mismatch')
    if any(p['files'].get(n)!=v for n,v in frozen_files.items()):raise ValueError('frozen requirement file changed')
    glue=json.loads(p['files']['glue.json'])
    descriptions=glue.get('exports',[])
    if (glue.get('id')!=p['job'] or len(descriptions)!=1 or descriptions[0].get('name')!=signature['name'] or descriptions[0].get('result',{}).get('unit')!=signature['output']['unit']
            or [(a.get('name'),a.get('unit')) for a in descriptions[0].get('args',[])]!=[(a['path'],a['unit']) for a in signature['inputs']]):
        raise ValueError('glue metadata is incompatible with frozen signature')
    compile_candidate(root,jobdir)
    verdict=invoke_cases(jobdir)
    if not verdict['passed']:return {'published':False,'outcome':'failed-eval','quality':verdict}
    result=run_attempt(Path(root)/'runtime',attempt or 'verify-'+uuid.uuid4().hex[:12],p['job'],payload,digest(payload),digest(payload),_script('gate'),timeout=75)
    write(jobdir/'publication-receipt.json',result)
    state=json.loads((jobdir/'state.json').read_text());state.update(stage='published' if result['published'] else 'failed',pendingStages=[],artifactHash=digest(payload),wasmHash=digest(jobdir/'kernel.wasm'));write(jobdir/'state.json',state)
    return result


def evaluator_prompt(view):
    return ('Return ONLY JSON with keys procedures and cases. You are an independent executable eval writer. You receive raw request and bare signature ONLY; no generator code or assumptions. Use version1 procedural evals. For a linear numeric function provide [{version:1,id:"linear",kind:"affine",input:"ARG",domain:[LO,HI],count:12,seed:7919,slope:NUMBER,offset:NUMBER,tolerance:REQUEST_TOL,unit:"UNIT"}]. Derive expected relationship independently from request. Cases are [{id:"...",inputs:{ARG:VALUE},expect:NUMBER,tolerance:TOL,unit:"UNIT"}] or refusal cases with expectError:true,errorPath:"ARG",tolerance:0,unit:"UNIT". Include NaN/Infinity/-Infinity as strings, both just-outside-domain refusals and missing-input refusal. No prose.\nVIEW\n'+canonical(view))


def live_request(root,job,request,signature):
    raise RuntimeError('Two-family live pipeline disabled: Claude Code CLI prohibited; approved second route required')
    if not valid_id(job):raise ValueError('unsafe job identifier')
    root=Path(root);evidence=root/'work/live'/job;evidence.mkdir(parents=True,exist_ok=False)
    view={'version':1,'request':{'id':request['id'],'raw':request['raw']},'signature':signature,'reference':None}
    # Both writers are blind to each other's outputs and any maker output.
    writers=[];procedures=[];cases=[]
    for family in ['claude','codex']:
        result=run_model(root,job+'-eval-'+family,family,evaluator_prompt(view))
        answer=json.loads(strip_fences(result['text']));write(evidence/(family+'-eval.json'),answer)
        for p in answer['procedures']:
            p['id']=family+'-'+p['id'];procedures.append(p)
        for c in answer.get('cases',[]):
            c['id']=family+'-'+c['id'];cases.append(c)
        # Quality canonical hashing is independent of Python serialization.
        script="import * as q from './tools/factory_quality/index.mjs';import fs from 'fs';let x=JSON.parse(fs.readFileSync(0,'utf8'));console.log(q.hash(x));"
        view_hash=subprocess.check_output([str(NODE),'--input-type=module','-e',script],input=canonical(view),cwd=REPO,text=True).strip()
        writers.append({'family':family,'viewHash':view_hash,'outputHash':digest(evidence/(family+'-eval.json'))})
    bundle={'version':1,'request':request,'signature':signature,'writers':writers,'procedures':procedures,'cases':cases}
    jobdir=root/'work/jobs'/job
    prepare(jobdir,request,signature,bundle)
    frozen=json.loads((jobdir/'frozen.json').read_text())
    result=run_model(root,job+'-generator','claude',maker_prompt(request,signature),role='generator',freeze={'version':1,'frozen':True,'suiteSha256':frozen['suiteHash']})
    add_candidate(jobdir,result['text'])
    return jobdir
