"""One-shot frozen-arm synthetic holdout with independent local/hosted writers."""
import copy,json,math,sys,uuid
from pathlib import Path
from tools.factory_campaign import pipeline as p
from tools.factory_campaign.execute50 import PROTOCOL,digest_obj
from tools.factory_campaign.models import run_model,strip_fences
from tools.factory_campaign.local_model import run_local
from tools.factory_campaign.compare50 import run_group
from tools.factory_runtime import wasm
C=p.REPO/'campaigns/next50-20261018'

def reference(ref,x):
    return x*ref['slope']+ref['offset']if ref['kind']=='affine'else(ref['below']if x<ref['threshold']else ref['above'])

def main():
    assert json.loads((C/'control/gate-b.json').read_text())['passed']
    dev=C/'work/complete50/d32f00a2ea1346a1bcc98804f40d7f47';assert(dev/'paired-results.json').is_file()
    source=C/'audit/holdout/packet.json';expected='fbd7652d6f22aa85645cc4e37eb500a7d0c4add5129cfd9470c852825a6f30dc';assert p.digest(source)==expected
    marker=C/'control/holdout-started.json'
    with marker.open('x')as stream:json.dump({'packetHash':expected,'configHash':p.digest(C/'control/comparison-precommit.json'),'once':True},stream)
    packet=json.loads(source.read_text());packet=packet if isinstance(packet,list)else packet['requests']
    out=C/'work/holdout50'/uuid.uuid4().hex;out.mkdir(parents=True)
    views=[{'version':1,'request':{'id':x['request']['id'],'raw':x['request']['raw']},'signature':x['signature'],'reference':None}for x in packet]
    p.write(out/'precommit.json',{'packetHash':expected,'armHash':p.digest(C/'control/comparison-precommit.json'),'protocolHash':__import__('hashlib').sha256(PROTOCOL.encode()).hexdigest(),'views':views,'scope':'two untouched synthetic requests; no optimizer tuning'})
    answers={}
    for family in ['codex','qwen']:
        stage='holdout-eval-'+family+'-'+out.name[:8]
        reply=run_model(C,stage,'codex',PROTOCOL+p.canonical(views),role='eval_writer')if family=='codex'else run_local(C,stage,PROTOCOL+p.canonical(views))
        answers[family]=json.loads(strip_fences(reply['text']));p.write(out/(family+'.json'),answers[family]);p.write(out/(family+'-metadata.json'),reply['metadata'])
    qualifications=[]
    for i,item in enumerate(packet):
        request=item['request'];signature=item['signature'];ref=item['reference'];key=signature['inputs'][0]['path'];procedures=[];cases=[];writers=[]
        for family,answer in answers.items():
            found=next(x for x in answer['requests']if x['id']==request['id']);a=copy.deepcopy(found)
            for procedure in a['procedures']:procedure['id']=family+'-'+procedure['id'];procedures.append(procedure)
            for case in a['cases']:case['id']=family+'-'+case['id'];cases.append(case)
            writers.append({'family':family,'viewHash':digest_obj(views[i]),'outputHash':digest_obj(found)})
        bundle={'version':1,'request':request,'signature':signature,'writers':writers,'procedures':procedures,'cases':[*cases,*p.mandatory_cases(signature)]};p.write(out/f'{i}-bundle.json',bundle)
        frozen=p.quality('freeze',out/f'{i}-bundle.json',out/f'{i}-frozen.json');expanded=p.quality('cases',out/f'{i}-frozen.json')
        def valid(c):
            x=c['inputs'].get(key);lo,hi=signature['inputs'][0]['domain'];return type(x)in[int,float]and math.isfinite(x)and lo<=x<=hi
        outputs=[{'caseId':c['id'],'value':reference(ref,c['inputs'][key]),'unit':signature['output']['unit']}if valid(c)else{'caseId':c['id'],'error':{'path':key}}for c in expanded]
        good={'signature':signature,'outputs':outputs};controls=[{'id':'known-good','kind':'good','candidate':good}];number=next(j for j,o in enumerate(outputs)if'value'in o);error=next(j for j,o in enumerate(outputs)if'error'in o)
        for name,kind,code,index,change in [('wrong-answer','canary','value',number,{'value':outputs[number]['value']+1}),('bad-refusal','canary','refusal-path',error,{'error':{'path':'wrong'}}),('wrong-unit','mutation','unit',number,{'unit':'wrong'})]:
            mutant=copy.deepcopy(good);mutant['outputs'][index].update(change);controls.append({'id':name,'kind':kind,'expectedCode':code,'candidate':mutant})
        p.write(out/f'{i}-controls.json',{'frozen':frozen,'controls':controls,'thresholds':{'canaryRecall':1,'falseRejection':0,'mutationSensitivity':1}});qualified=p.quality('qualify',out/f'{i}-controls.json',out/f'{i}-qualification.json',check=False)
        agreement=all(bool(c.get('expectError'))==(not valid(c))and(not valid(c)or abs(c['expect']-reference(ref,c['inputs'][key]))<=min(c['tolerance'],ref.get('tolerance',1e-9)))for c in expanded)
        qualifications.append({'id':request['id'],'passed':qualified['passed']and agreement,'writerAgreement':agreement,'qualification':qualified})
    p.write(out/'qualification.json',{'passed':all(q['passed']for q in qualifications),'requests':qualifications,'freshSynthetic':True})
    if not all(q['passed']for q in qualifications):raise RuntimeError('Holdout eval quality failed; no generator bypass or tuning')
    complete(out)

def complete(out):
    out=Path(out);source=C/'audit/holdout/packet.json';packet=json.loads(source.read_text());packet=packet if isinstance(packet,list)else packet['requests']
    qualifications=[json.loads((out/f'{i}-qualification.json').read_text())for i in range(2)]
    if (out/'holdout-results.json').exists()and(out/'consumer.json').exists():
        rows=json.loads((out/'holdout-results.json').read_text())['rows'];consumer=json.loads((out/'consumer.json').read_text())
        p.write(C/'control/holdout-result.json',{'passed':consumer['passed'],'path':str(out),'rows':rows,'qualification':qualifications,'consumer':consumer['rows'],'once':True,'freshSynthetic':True,'modelMetadata':consumer['metadata'],'finalizationReusedCompletedStages':True})
        print(json.dumps({'passed':consumer['passed'],'path':str(out),'finalizationOnly':True,'modelCalls':0}));return
    run_group(out,'holdout')
    rows=json.loads((out/'holdout-results.json').read_text())['rows'];tasks=[]
    for i,item in enumerate(packet):
        lo,hi=item['signature']['inputs'][0]['domain'];value=lo+(hi-lo)*.371;tasks.append({'id':item['request']['id'],'signature':item['signature'],'question':'Invoke this capability for '+item['signature']['inputs'][0]['path']+'='+str(value),'value':value})
    visible=[{k:v for k,v in t.items()if k!='value'}for t in tasks]
    reply=run_model(C,'holdout-consumer-'+out.name[:8],'codex','Consume the typed capability interfaces. Return only JSON {"plans":[{"id":"request id","function":"export name","args":[NUMBER]}]}. No implementation or eval is provided. TASKS:\n'+p.canonical(visible),role='consumer')
    plans=json.loads(strip_fences(reply['text']))['plans'];consumer=[]
    for row in rows:
        i=next(i for i,x in enumerate(packet)if x['request']['id']==row['request']);item=packet[i];task=tasks[i];plan=next(x for x in plans if x['id']==task['id']);sig=item['signature']
        r=wasm.run(Path(row['job'])/'kernel.wasm',export=sig['name'],args=plan['args']);wanted=reference(item['reference'],task['value'])
        completed=plan['function']==sig['name']and plan['args']==[task['value']]and r['exit']==0 and abs(float(r['stdout'].strip().splitlines()[-1])-wanted)<=item['reference'].get('tolerance',1e-9)
        consumer.append({'request':row['request'],'arm':row['arm'],'completedValid':completed,'expected':wanted,'plan':plan,'runtime':r,'retries':0,'clarifications':0})
    p.write(out/'consumer.json',{'passed':all(x['completedValid']for x in consumer),'rows':consumer,'metadata':reply['metadata'],'postHocModelJudging':False})
    p.write(C/'control/holdout-result.json',{'passed':all(x['completedValid']for x in consumer),'path':str(out),'rows':rows,'qualification':qualifications,'consumer':consumer,'once':True,'freshSynthetic':True,'modelMetadata':reply['metadata']})
    print(json.dumps({'passed':all(x['completedValid']for x in consumer),'path':str(out),'arms':len(rows),'consumerCompleted':sum(x['completedValid']for x in consumer)}))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='complete-resolved':
        path=Path(sys.argv[2]);assert json.loads((path/'resolution.json').read_text())['resolvedQualityPassed'];complete(path)
    else:main()
