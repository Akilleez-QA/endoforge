"""Actual qualified-suite workflow controls, reuse and frozen-requirement repair."""
import copy,json,uuid
from pathlib import Path
from tools.factory_campaign import pipeline as p,catalog
from tools.factory_campaign.repair import patch
from tools.factory_campaign.test import GOOD

C=p.REPO/'campaigns/next50-20261018'

def main():
    source=C/'quality/qualified-development-d32f00a2ea13';bundle=json.loads((source/'0-bundle.json').read_text());bundle['cases']=[c for c in bundle['cases']if not c['id'].startswith('host-validity-')]
    run=C/'work/workflow-qualified'/uuid.uuid4().hex;run.mkdir(parents=True);rows=[]
    def one(name,code,mutate=None):
        root=run/name;job=root/'job';p.prepare(job,bundle['request'],bundle['signature'],bundle);p.add_candidate(job,code)
        if mutate:
            payload=json.loads((job/'capability.json').read_text());mutate(payload);p.write(job/'capability.json',payload)
        try:result=p.verify_publish(root,job)
        except Exception as e:result={'published':False,'outcome':'rejected','error':str(e)}
        rows.append({'name':name,'result':result});return root,job,result
    root,job,result=one('known-good',GOOD);assert result.get('published'),result
    for name,code,mutate in [('wrong-answer',GOOD.replace('c*1.8+32','42'),None),('wrong-question',GOOD.replace('c*1.8+32','c/1.8+32'),None),('corrupt-freeze',GOOD,lambda o:o['files'].__setitem__('frozen.sha256','corrupt')),('missing-output',GOOD.replace('celsiusToFahrenheit','wrong'),None),('forged-worker-success','process.stdout.write("passed");',None)]:
        _,_,r=one(name,code,mutate);assert not r.get('published'),(name,r)
    signature=bundle['signature'];facts=bundle['request']['requiredFacts'];raw=bundle['request']['raw'];cache=run/'catalog'
    catalog.register(cache,job/'capability.json',signature,facts,[],raw,result);hit=catalog.lookup(cache,signature,facts,[],raw);assert hit['outcome']=='reused'
    misses=[]
    for contract,refs in [('Return constant42',[]),(raw,['new-reference-version'])]:
        r=catalog.lookup(cache,signature,facts,refs,contract);assert r['outcome']=='miss';misses.append(r)
    # Retain the actual failed candidate; patch a new source artifact only.
    broken=run/'wrong-answer/job';badcode=GOOD.replace('c*1.8+32','c*1.7+32');rroot,rjob,failed=one('repair-initial',badcode);assert not failed.get('published')
    src=rjob/'kernel.ts';src.write_text(badcode);protected=[rjob/'frozen.json',rjob/'frozen-files.json'];repair=patch(src,p.digest(src),'c*1.7+32','c*1.8+32',protected,'implementation-defect',0)
    retry=run/'repair-new-attempt';retryjob=retry/'job';p.prepare(retryjob,bundle['request'],bundle['signature'],bundle);p.add_candidate(retryjob,Path(repair['patchedPath']).read_text());repaired=p.verify_publish(retry,retryjob);assert repaired.get('published')
    assert json.loads((rjob/'capability.json').read_text())['files']['kernel.ts'].strip()==badcode
    report={'version':1,'passed':True,'twoFamilyQualification':str(source/'qualification.json'),'workflowControls':rows,'reuse':{'outcome':hit['outcome'],'modelCalls':0,'incompatibleMisses':len(misses)},'repair':{'failed':failed,'patch':repair,'newAttempt':repaired,'modelCalls':0,'oldFailurePreserved':True},'root':str(run),'limits':['Repair control is deterministic implementation patch, not a model-generated patch.','One-input numeric qualified scope.']}
    dest=C/'control/qualified-workflow-controls.json';p.write(dest,report);print(json.dumps({'passed':True,'controls':len(rows),'report':str(dest)}))

if __name__=='__main__':main()
