"""Planned independent source resolution; original failed holdout run is immutable."""
import copy,json,math,shutil,subprocess,sys,uuid
from pathlib import Path
from tools.factory_campaign import pipeline as p
from tools.factory_campaign.execute50 import digest_obj
from tools.factory_campaign.holdout50 import reference
C=p.REPO/'campaigns/next50-20261018'

def main(original):
    original=Path(original);source=C/'audit/holdout/packet.json';packet=json.loads(source.read_text());packet=packet if isinstance(packet,list)else packet['requests'];out=original.parent/('resolved-'+uuid.uuid4().hex[:12]);out.mkdir()
    for name in ['precommit.json','codex.json','qwen.json','codex-metadata.json','qwen-metadata.json']:shutil.copy2(original/name,out/name)
    answers={f:json.loads((original/(f+'.json')).read_text())for f in ['codex','qwen']};resolution=[]
    for i,item in enumerate(packet):
        request=item['request'];sig=item['signature'];ref=item['reference'];key=sig['inputs'][0]['path'];domain=sig['inputs'][0]['domain'];procedures=[];cases=[];writers=[];all_raw=[]
        for family,answer in answers.items():
            row=next(r for r in answer['requests']if r['id']==request['id']);row=copy.deepcopy(row)
            writers.append({'family':family,'viewHash':digest_obj(json.loads((out/'precommit.json').read_text())['views'][i]),'outputHash':digest_obj(row)})
            for procedure in row['procedures']:
                if procedure['domain']!=domain or procedure['unit']!=sig['output']['unit']:raise ValueError('unresolved domain/unit change')
                script="import * as q from './tools/factory_quality/index.mjs';import fs from 'fs';console.log(JSON.stringify(q.expandProcedure(JSON.parse(fs.readFileSync(0,'utf8')))));"
                expanded=json.loads(subprocess.check_output([str(p.NODE),'--input-type=module','-e',script],input=json.dumps(procedure),cwd=p.REPO,text=True))
                for case in expanded:
                    wanted=reference(ref,case['inputs'][key]);assert abs(wanted-case['expect'])<=min(case['tolerance'],ref.get('tolerance',1e-9)),'unresolved procedural reference error'
                    all_raw.append({'family':family,'case':case,'procedural':True})
                procedure['id']=family+'-'+procedure['id'];procedures.append(procedure)
            for case in row['cases']:all_raw.append({'family':family,'case':case,'procedural':False})
        for raw in all_raw:
            if raw['procedural']:continue
            case=copy.deepcopy(raw['case']);x=case['inputs'].get(key);valid=type(x)in[int,float]and math.isfinite(x)and domain[0]<=x<=domain[1]
            if bool(case.get('expectError'))==valid:raise ValueError('unresolved refusal truth change')
            if valid:
                wanted=reference(ref,x);tolerance=min(case['tolerance'],ref.get('tolerance',1e-9))
                if abs(case['expect']-wanted)>tolerance:
                    others=[v for v in all_raw if v['family']!=raw['family']and v['case']['inputs']==case['inputs']and not v['case'].get('expectError')and abs(v['case']['expect']-wanted)<=tolerance]
                    if not others:raise ValueError('no independent writer proposition agrees with sealed source')
                    proposals=[{'writer':raw['family']+':'+case['id'],'value':case['expect']},{'writer':others[0]['family']+':'+others[0]['case']['id'],'value':others[0]['case']['expect']}]
                    records=[{'key':sig['name'],'inputs':case['inputs'],'value':wanted,'unit':sig['output']['unit']}]
                    provider={'version':1,'name':'sealed-synthetic-reference','providerVersion':p.digest(source),'source':str(source),'contentHash':digest_obj(records),'interpolation':'exact-only','units':{key:sig['inputs'][0]['unit'],'value':sig['output']['unit']},'limits':{sig['name']:{key:domain}},'records':records}
                    payload={'proposals':proposals,'provider':provider,'key':sig['name'],'inputs':case['inputs'],'tolerance':tolerance}
                    script="import * as q from './tools/factory_quality/index.mjs';import fs from 'fs';const x=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(q.resolveDisagreement(x.proposals,x.provider,x.key,x.inputs,x.tolerance)));"
                    verdict=json.loads(subprocess.check_output([str(p.NODE),'--input-type=module','-e',script],input=json.dumps(payload),cwd=p.REPO,text=True));assert verdict['status']=='resolved';resolution.append({'case':case,'family':raw['family'],'request':request['id'],'sealedSourceHash':p.digest(source),'provider':provider,'resolution':verdict});case['expect']=verdict['value']
            case['id']=raw['family']+'-'+case['id'];cases.append(case)
        bundle={'version':1,'request':request,'signature':sig,'writers':writers,'procedures':procedures,'cases':[*cases,*p.mandatory_cases(sig)]};p.write(out/f'{i}-bundle.json',bundle);frozen=p.quality('freeze',out/f'{i}-bundle.json',out/f'{i}-frozen.json');expanded=p.quality('cases',out/f'{i}-frozen.json')
        outputs=[]
        for case in expanded:
            x=case['inputs'].get(key);valid=type(x)in[int,float]and math.isfinite(x)and domain[0]<=x<=domain[1]
            outputs.append({'caseId':case['id'],'value':reference(ref,x),'unit':sig['output']['unit']}if valid else{'caseId':case['id'],'error':{'path':key}})
        good={'signature':sig,'outputs':outputs};n=next(j for j,x in enumerate(outputs)if'value'in x);e=next(j for j,x in enumerate(outputs)if'error'in x);controls=[{'id':'known-good','kind':'good','candidate':good}]
        for name,kind,code,index,change in [('wrong-value','canary','value',n,{'value':outputs[n]['value']+1}),('wrong-refusal','canary','refusal-path',e,{'error':{'path':'wrong'}}),('wrong-unit','mutation','unit',n,{'unit':'wrong'})]:
            mutant=copy.deepcopy(good);mutant['outputs'][index].update(change);controls.append({'id':name,'kind':kind,'expectedCode':code,'candidate':mutant})
        p.write(out/f'{i}-controls.json',{'frozen':frozen,'controls':controls,'thresholds':{'canaryRecall':1,'falseRejection':0,'mutationSensitivity':1}});qualified=p.quality('qualify',out/f'{i}-controls.json',out/f'{i}-qualification.json',check=False);assert qualified['passed']
    p.write(out/'resolution.json',{'version':1,'rawWriterAgreement':False,'originalRun':str(original),'originalSources':{name:p.digest(original/name)for name in ['codex.json','qwen.json','0-bundle.json','precommit.json']},'sealedReferenceHash':p.digest(source),'deviation':str(C/'control/HOLDOUT-RESOLUTION-DEVIATION.md'),'corrections':resolution,'generatorHadStarted':False,'writersRerun':False,'armsChanged':False,'resolvedQualityPassed':True})
    p.write(C/'control/holdout-resolved-pointer.json',{'path':str(out),'original':str(original),'resolutionHash':p.digest(out/'resolution.json')});print(out)

if __name__=='__main__':main(sys.argv[1])
