"""Frozen-arm generation and actual machine verification; no model verdicts."""
import copy,json,sys,time,uuid
from pathlib import Path
from tools.factory_campaign import pipeline as p
from tools.factory_campaign.models import run_model
from tools.factory_campaign.control import digest

C=p.REPO/'campaigns/next50-20261018'

def generate(out,index,label,arm='incumbent',verify=True):
    out=Path(out);bundle=copy.deepcopy(json.loads((out/f'{index}-bundle.json').read_text()))
    bundle['cases']=[c for c in bundle['cases']if not c['id'].startswith('host-validity-')]
    request=bundle['request'];signature=bundle['signature'];run=C/'work/executed50'/label
    run.mkdir(parents=True,exist_ok=False);job=run/'jobs'/request['id']
    config=json.loads((C/'control/comparison-precommit.json').read_text())
    manifest={'version':1,'job':request['id'],'scope':'synthetic development'if'holdout'not in label else'synthetic holdout','arm':arm,'requestHash':digest(out/f'{index}-bundle.json'),'configHash':digest(C/'control/comparison-precommit.json'),'jobdir':str(job),'stages':[]}
    p.write(run/'manifest.json',manifest)
    started=time.monotonic();frozen,cases=p.prepare(job,request,signature,bundle)
    qualified=json.loads((out/f'{index}-frozen.json').read_text())
    if frozen['suiteHash']!=qualified['suiteHash']:raise ValueError('generation changed qualified frozen eval')
    prompt=p.maker_prompt(request,signature)
    if arm=='candidate':prompt+='\n'+config['arms']['candidateAppend']
    reply=run_model(C,'generate-'+label,'codex',prompt,role='generator',freeze={'version':1,'frozen':True,'suiteSha256':frozen['suiteHash']})
    p.add_candidate(job,reply['text']);p.write(run/'model.json',reply['metadata'])
    result={'version':1,'label':label,'request':request['id'],'arm':arm,'job':str(job),'run':str(run),'family':'codex','modelMetadata':reply['metadata'],'allAssigned':1,'outcome':'generated','completedValid':False}
    if verify:
        verification=p.verify_publish(run,job);result.update(outcome=verification['outcome'],completedValid=bool(verification.get('published')),verification=verification)
        if result['completedValid']:
            state=json.loads((job/'state.json').read_text());state['completedStages']=['intake','paired-evals','freeze','generate','compile','bounded-evals','trusted-gates','publish'];state['pendingStages']=['portable-consumer'];p.write(job/'state.json',state)
    result['wallMs']=(time.monotonic()-started)*1000;manifest['stages']=json.loads((job/'state.json').read_text())
    p.write(run/'manifest.json',manifest);p.write(run/'result.json',result);print(json.dumps(result),flush=True);return result


def run_group(out,mode):
    out=Path(out);rows=[];tag=uuid.uuid4().hex[:8]
    if mode=='clean':rows=[generate(out,0,'clean-'+tag)]
    elif mode=='aa':
        for repeat in range(2):
            for i in range(3):rows.append(generate(out,i,f'aa-{tag}-{repeat}-{i}'))
    elif mode=='paired':
        for i in range(3):
            for arm in (['incumbent','candidate']if i%2==0 else['candidate','incumbent']):rows.append(generate(out,i,f'paired-{tag}-{i}-{arm}',arm))
    elif mode=='holdout':
        for i in range(2):
            for arm in (['candidate','incumbent']if i%2==0 else['incumbent','candidate']):rows.append(generate(out,i,f'holdout-{tag}-{i}-{arm}',arm))
    p.write(out/(mode+'-results.json'),{'version':1,'mode':mode,'rows':rows,'denominator':len(rows),'completedValid':sum(r['completedValid']for r in rows),'unsupported':0,'underdetermined':0})

if __name__=='__main__':run_group(sys.argv[1],sys.argv[2])
