"""Controlled two-family development qualification; refuses missing subscription auth."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

from tools.factory_campaign.models import run_model,strip_fences
from tools.factory_campaign.pipeline import REPO,NODE,quality,write,canonical,mandatory_cases

C=REPO/'campaigns/next50-20261018'


def requests():
    q=C/'quality';packet=[(json.loads((q/'development-request.json').read_text()),json.loads((q/'development-signature.json').read_text()))]
    for ident,raw,name,key,unit,out,domain,plausible in [
        ('dev-length-02','Convert finite metres m in [0,1000000] to kilometres, absolute tolerance 1e-9 km. Refuse nonfinite, missing and out-of-domain m naming m.','metresToKilometres','m','m','km',[0,1000000],[{'value':0,'result':0},{'value':1000,'result':1}]),
        ('dev-threshold-03','Classify finite score s in [0,100] as numeric 0 when s<60, numeric 1 when s>=60. Refuse nonfinite, missing and out-of-domain s naming s. Absolute tolerance0; unit score-class.','classifyScore','s','score','score-class',[0,100],[{'value':59,'result':0},{'value':60,'result':1}])]:
        request={'version':1,'id':ident,'raw':raw,'artifactClass':'closed-form','requiredFacts':[{'path':key,'unit':unit,'domain':domain,'tolerance':1e-9,'plausible':plausible}],'sources':['explicit request; SI kilo for metric conversion']}
        signature={'version':1,'name':name,'inputs':[{'path':key,'type':'number','unit':unit,'domain':domain}],'output':{'type':'number','unit':out}}
        packet.append((request,signature))
    return packet


def hash_object(value):
    script="import{hash}from './tools/factory_quality/index.mjs';import fs from 'fs';console.log(hash(JSON.parse(fs.readFileSync(0,'utf8'))));"
    return subprocess.check_output([str(NODE),'--input-type=module','-e',script],input=canonical(value),cwd=REPO,text=True).strip()


PROMPT='''Write executable evals from ONLY raw request and bare signature. Return JSON only {"procedure":{...},"cases":[...]}. Procedure version1,id,kind affine or threshold,input,domain:[lo,hi],seed7919,count16,tolerance,unit. For affine include slope,offset. For threshold include threshold,below,above. Explicit cases include NaN,Infinity,-Infinity STRING inputs, below/above-domain and missing input {}, with expectError:true,errorPath:argument,tolerance:0,unit. Value cases include expect:number. Never see generator code, assumptions or prior writer output. Do not add unknown keys. VIEW:\n'''


def main():
    print('BLOCKED: Claude Code CLI prohibited by user; an allowed independent second route is required.',file=sys.stderr)
    return 75
    run='controlled-evals-'+uuid.uuid4().hex[:12];out=C/'quality'/run;out.mkdir()
    packet=requests();pre={'version':1,'scope':'three declared development requests, not fresh holdout','thresholds':{'canaryRecall':1,'falseRejection':0,'mutationSensitivity':1,'writerAgreement':1},'turns':6,'modelBoundary':'final provider-only runtime role wrapper','sources':{str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),REPO/'tools/factory_runtime/egress.py',REPO/'tools/factory_quality/index.mjs']},'requests':packet,'prompt':PROMPT}
    write(out/'precommit.json',pre);write(out/'precommit.sha.json',{'sha256':hashlib.sha256((out/'precommit.json').read_bytes()).hexdigest()})
    results=[]
    for i,(request,signature) in enumerate(packet):
        view={'version':1,'request':{'id':request['id'],'raw':request['raw']},'signature':signature,'reference':None};writers=[];procedures=[];cases=[]
        for family in ['claude','codex']:
            r=run_model(C,run+'-'+str(i)+'-'+family,family,PROMPT+canonical(view),role='eval_writer')
            answer=json.loads(strip_fences(r['text']));write(out/f'{i}-{family}.json',answer)
            for p in [answer['procedure']]:p['id']=family+'-'+p['id'];procedures.append(p)
            for c in answer['cases']:c['id']=family+'-'+c['id'];cases.append(c)
            writers.append({'family':family,'viewHash':hash_object(view),'outputHash':hash_object(answer)})
        bundle={'version':1,'request':request,'signature':signature,'writers':writers,'procedures':procedures,'cases':[*cases,*mandatory_cases(signature)]};write(out/f'{i}-bundle.json',bundle)
        frozen=quality('freeze',out/f'{i}-bundle.json',out/f'{i}-frozen.json');expanded=quality('cases',out/f'{i}-frozen.json')
        key=signature['inputs'][0]['path']
        def ref(x):
            if i==0:return x*9/5+32
            if i==1:return x/1000
            return 0 if x<60 else 1
        outputs=[]
        for c in expanded:
            if c.get('expectError'):outputs.append({'caseId':c['id'],'error':{'path':key}})
            else:outputs.append({'caseId':c['id'],'value':ref(c['inputs'][key]),'unit':signature['output']['unit']})
        good={'signature':signature,'outputs':outputs};controls=[{'id':'known-good','kind':'good','candidate':good}]
        def mutant(name,kind,code,mutate):
            candidate=copy.deepcopy(good);mutate(candidate);controls.append({'id':name,'kind':kind,'expectedCode':code,'candidate':candidate})
        numeric=next(j for j,o in enumerate(outputs) if 'value'in o)
        mutant('wrong-question','canary','value',lambda c:c['outputs'][numeric].update(value=c['outputs'][numeric]['value']+42.123456))
        mutant('wrong-export','canary','interface-identity',lambda c:c['signature'].update(name='wrongExport'))
        refusal=next(j for j,o in enumerate(outputs) if 'error'in o)
        mutant('bad-refusal','canary','refusal-path',lambda c:c['outputs'][refusal].update(error={'path':'wrong'}))
        mutant('bad-unit','mutation','unit',lambda c:c['outputs'][numeric].update(unit='wrong'))
        mutant('arithmetic','mutation','value',lambda c:c['outputs'][numeric].update(value=c['outputs'][numeric]['value']+1))
        write(out/f'{i}-packet.json',{'frozen':frozen,'controls':controls,'thresholds':pre['thresholds']})
        qualification=quality('qualify',out/f'{i}-packet.json',out/f'{i}-qualification.json',check=False)
        results.append({'id':request['id'],'passed':qualification['passed'],'frozen':str(out/f'{i}-frozen.json'),'qualification':qualification})
        if not qualification['passed']:break
    summary={'version':1,'gateA':len(results)==3 and all(r['passed']for r in results),'scope':'declared small numeric development packet','results':results,'usesPostHocModelJudging':False}
    write(out/'summary.json',summary);write(C/'control/gate-a.json',{'source':str(out/'summary.json'),'passed':summary['gateA']})
    print(json.dumps({'gateA':summary['gateA'],'path':str(out)}))
    return 0 if summary['gateA'] else 1


if __name__=='__main__':raise SystemExit(main())
