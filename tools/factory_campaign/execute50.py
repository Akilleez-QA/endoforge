"""Bounded Codex + local Qwen execution; no Claude Code route."""
import copy,json,hashlib,sys,time,uuid,math
from pathlib import Path
from tools.factory_campaign import pipeline as p
from tools.factory_campaign.models import run_model,strip_fences
from tools.factory_campaign.qualify_evals import requests

C=p.REPO/'campaigns/next50-20261018'
PROTOCOL='''You are an independent executable-eval writer. See ONLY each raw request and bare signature. Return ONLY JSON {"requests":[{"id":"request id","procedures":[PROCEDURE],"cases":[CASES]}]}. PROCEDURE is {"version":1,"id":"values","kind":"affine","input":"ARG","domain":[LO,HI],"count":6,"seed":7919,"slope":NUMBER,"offset":NUMBER,"tolerance":NUMBER,"unit":"OUTPUTUNIT"}; for a numeric threshold use kind:"threshold",threshold:NUMBER,below:NUMBER,above:NUMBER instead of slope/offset. Derive every expected relationship independently from the raw request. Explicit cases include at least one valid expected value and missing input plus nonfinite/outside-domain refusal. A value case is {"id":"unique","inputs":{"ARG":NUMBER},"expect":NUMBER,"tolerance":NUMBER,"unit":"UNIT"}. A refusal case is {"id":"unique","inputs":{"ARG":"NaN"},"expectError":true,"errorPath":"ARG","tolerance":0,"unit":"UNIT"}; missing uses inputs:{}. No prose or additional fields. VIEWS:\n'''

def digest_obj(x):
    import subprocess
    script="import{hash}from './tools/factory_quality/index.mjs';import fs from 'fs';console.log(hash(JSON.parse(fs.readFileSync(0,'utf8'))));"
    return subprocess.check_output([str(p.NODE),'--input-type=module','-e',script],input=p.canonical(x),cwd=p.REPO,text=True).strip()

def begin():
    out=C/'work/complete50'/uuid.uuid4().hex;out.mkdir(parents=True)
    packet=requests();views=[{'version':1,'request':{'id':r['id'],'raw':r['raw']},'signature':s,'reference':None}for r,s in packet]
    pre={'version':1,'scope':'declared development packet; Codex and local Qwen, no historical holdout reuse','packet':packet,'views':views,'protocol':PROTOCOL,'thresholds':{'canaryRecall':1,'falseRejection':0,'mutationSensitivity':1,'writerAgreement':1},'sources':{str(x.relative_to(p.REPO)):p.digest(x)for x in [Path(__file__),C/'control/LOCAL-INFERENCE-AMENDMENT.md',p.REPO/'tools/factory_quality/index.mjs']}}
    p.write(out/'precommit.json',pre);p.write(out/'precommit-sha.json',{'sha256':p.digest(out/'precommit.json')})
    print(out,flush=True)
    reply=run_model(C,'eval-codex-'+out.name[:12],'codex',PROTOCOL+p.canonical(views),role='eval_writer')
    answer=json.loads(strip_fences(reply['text']));p.write(out/'codex.json',answer);p.write(out/'codex-metadata.json',reply['metadata']);return out

def qualify(out):
    out=Path(out);pre=json.loads((out/'precommit.json').read_text());writers={f:json.loads((out/(f+'.json')).read_text())for f in ['codex','qwen']};summ=[]
    for i,(request,signature)in enumerate(pre['packet']):
        procedures=[];cases=[];identities=[]
        for family,answers in writers.items():
            answer=next(a for a in answers['requests']if a['id']==request['id']);ans=copy.deepcopy(answer)
            for procedure in ans['procedures']:procedure['id']=family+'-'+procedure['id'];procedures.append(procedure)
            for case in ans['cases']:case['id']=family+'-'+case['id'];cases.append(case)
            identities.append({'family':family,'viewHash':digest_obj(pre['views'][i]),'outputHash':digest_obj(answer)})
        bundle={'version':1,'request':request,'signature':signature,'writers':identities,'procedures':procedures,'cases':[*cases,*p.mandatory_cases(signature)]};p.write(out/f'{i}-bundle.json',bundle)
        frozen_path=out/f'{i}-frozen.json'
        if frozen_path.exists():
            frozen=json.loads(frozen_path.read_text())
            if frozen['suite']!=bundle:raise ValueError('existing frozen suite changed')
        else:frozen=p.quality('freeze',out/f'{i}-bundle.json',frozen_path)
        expanded=p.quality('cases',frozen_path);key=signature['inputs'][0]['path']
        def ref(x):return x*1.8+32 if i==0 else x/1000 if i==1 else 0 if x<60 else 1
        def valid(c):
            x=c['inputs'].get(key);lo,hi=signature['inputs'][0]['domain']
            return type(x)in[int,float]and math.isfinite(x)and lo<=x<=hi
        outputs=[{'caseId':c['id'],'value':ref(c['inputs'][key]),'unit':signature['output']['unit']}if valid(c)else{'caseId':c['id'],'error':{'path':key}}for c in expanded]
        good={'signature':signature,'outputs':outputs};controls=[{'id':'known-good','kind':'good','candidate':good}];numeric=next(j for j,x in enumerate(outputs)if'value'in x);refusal=next(j for j,x in enumerate(outputs)if'error'in x)
        for name,kind,code,target,change in [('wrong-question','canary','value',numeric,{'value':outputs[numeric]['value']+42}),('bad-refusal','canary','refusal-path',refusal,{'error':{'path':'wrong'}}),('bad-unit','mutation','unit',numeric,{'unit':'wrong'}),('arithmetic','mutation','value',numeric,{'value':outputs[numeric]['value']+1})]:
            mutant=copy.deepcopy(good);mutant['outputs'][target].update(change);controls.append({'id':name,'kind':kind,'expectedCode':code,'candidate':mutant})
        mutant=copy.deepcopy(good);mutant['signature']['name']='wrongExport';controls.append({'id':'wrong-export','kind':'canary','expectedCode':'interface-identity','candidate':mutant})
        p.write(out/f'{i}-controls.json',{'frozen':frozen,'controls':controls,'thresholds':pre['thresholds']});q=p.quality('qualify',out/f'{i}-controls.json',out/f'{i}-qualification.json',check=False)
        # Each writer is independently checked against exact host reference outputs,
        # rather than agreeing merely because the other writer is present.
        agreement=all(bool(c.get('expectError'))==(not valid(c))and (not valid(c)or(c['tolerance']<=[1e-9,1e-9,0][i]and abs(c['expect']-ref(c['inputs'][key]))<=c['tolerance']))for c in expanded)
        summ.append({'id':request['id'],'passed':q['passed']and agreement,'writerAgreement':agreement,'qualification':q,'cases':len(expanded)})
    result={'passed':all(x['passed']for x in summ),'family':['codex','qwen'],'results':summ,'precommitHash':p.digest(out/'precommit.json')};p.write(out/'qualification-reference-validated.json',result);print(json.dumps(result));return result

if __name__=='__main__':
    if sys.argv[1]=='begin':begin()
    elif sys.argv[1]=='qualify':qualify(sys.argv[2])
