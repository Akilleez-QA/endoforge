#!/usr/bin/env python3
"""Real WASM/Docker negative controls; test-only writer provenance, never Gate A."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import uuid

from tools.factory_campaign import catalog, pipeline
from tools.factory_campaign.repair import patch

ROOT=Path(__file__).resolve().parents[2]
C=ROOT/'campaigns/next50-20261018'
GOOD='export function celsiusToFahrenheit(c:f64):f64 { if(c!=c || c < -273.15 || c > 1000) unreachable(); return c*1.8+32; }'


def main():
    run=C/'work/integration-controls'/uuid.uuid4().hex;run.mkdir(parents=True)
    template=json.loads((C/'quality/test-bundle.json').read_text());rows=[]
    for domain in ([1e308,1e308],[-1e308,1e308]):
        signature=copy.deepcopy(template['signature']);signature['inputs'][0]['domain']=domain
        boundary=pipeline.mandatory_cases(signature)
        assert boundary[3]['inputs']['c']<domain[0] and boundary[4]['inputs']['c']>domain[1]
    def case(name,code,mutate=None):
        b=copy.deepcopy(template);req=b['request'];req['id']=name
        d=run/name
        pipeline.prepare(d,req,b['signature'],b);pipeline.add_candidate(d,code)
        if mutate:
            obj=json.loads((d/'capability.json').read_text());mutate(obj);(d/'capability.json').write_text(pipeline.canonical(obj))
        try:result=pipeline.verify_publish(run,d);outcome=result['outcome'];published=result.get('published',False)
        except Exception as e:outcome='rejected';published=False;result={'error':str(e)}
        row={'name':name,'outcome':outcome,'published':published,'result':result};rows.append(row);return d,row
    positive,pos=case('control-good',GOOD);assert pos['published'],pos
    for name,code,mutation in [
        ('control-wrong-answer',GOOD.replace('c*1.8+32','42'),None),
        ('control-wrong-question',GOOD.replace('c*1.8+32','c/1.8+32'),None),
        ('control-missing-output',GOOD.replace('celsiusToFahrenheit','other'),None),
        ('control-forged-success','process.stdout.write("passed");',None),
        ('control-fuel-not-refusal',GOOD.replace('unreachable();','{ while(true) {} }'),None),
        ('control-corrupt-freeze',GOOD,lambda p:p['files'].__setitem__('frozen.sha256','{}\n')),
        ('control-bad-unit',GOOD,lambda p:p['files'].__setitem__('glue.json',p['files']['glue.json'].replace('degF','K'))),
    ]:
        _,row=case(name,code,mutation);assert not row['published'],row
    # An observationally equivalent source mutation should continue to pass.
    _,equivalent=case('control-equivalent',GOOD.replace('c*1.8+32','c*1.8+32+0'));assert equivalent['published']
    # Semantic contract mismatch must fail before a job is created.
    mismatch=copy.deepcopy(template);request=copy.deepcopy(mismatch['request']);request['raw']='Return constant42.'
    try:pipeline.prepare(run/'mismatch',request,mismatch['signature'],mismatch);raise AssertionError('request mismatch accepted')
    except ValueError:assert not (run/'mismatch').exists()
    sig=json.loads((positive/'signature.json').read_text());req=json.loads((positive/'request.json').read_text())
    facts=req['requiredFacts'];refs=[];pub=json.loads((positive/'publication-receipt.json').read_text())
    catalog.register(run/'catalog',positive/'capability.json',sig,facts,refs,req['raw'],pub)
    assert catalog.lookup(run/'catalog',sig,facts,refs,req['raw'])['outcome']=='reused'
    for s,f,r,contract in [(sig,facts,refs,'Return constant42.'),({**sig,'output':{'type':'number','unit':'K'}},facts,refs,req['raw']),(sig,facts,['changed-ref-version'],req['raw'])]:
        assert catalog.lookup(run/'catalog',s,f,r,contract)['outcome']=='miss'
    # Minimal source patch must preserve all freeze files and reject contract repair.
    src=run/'patch';src.mkdir();(src/'kernel.ts').write_text(GOOD.replace('1.8','1.7'))
    protected=[positive/'frozen.json',positive/'frozen-files.json'];sha=hashlib.sha256((src/'kernel.ts').read_bytes()).hexdigest()
    patched=patch(src/'kernel.ts',sha,'1.7','1.8',protected,'implementation-defect',0)
    assert Path(patched['patchedPath']).read_text()==GOOD
    try:patch(src/'kernel.ts',sha,'1.7','1.8',protected,'eval-defect',0);raise AssertionError('selfrelaxed eval')
    except ValueError:pass
    try:patch(src/'kernel.ts',sha,'1.7','1.8',protected,'implementation-defect',1);raise AssertionError('repair retry overflow')
    except ValueError:pass
    # Actual registered source and exact computation, with relevance and tamper controls.
    source=C/'quality/bipm-prefixes-source.html';comp=C/'quality/challenge-evidence.json';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    registry={str(p.resolve()):sha(p) for p in [source,comp]}
    evidence={'source':str(source.resolve()),'sourceSha256':sha(source),'computation':str(comp.resolve()),'computationSha256':sha(comp),'independentOfCandidate':True,'resolution':'eval-invalid'}
    ratio=copy.deepcopy(template);ratio['request']={'version':1,'id':'challenge-ratio','raw':'Convert finite metres m in [0,1000000] to kilometres. Refuse invalid m.','artifactClass':'closed-form','requiredFacts':[{'path':'m','unit':'m','domain':[0,1000000],'tolerance':1e-9,'plausible':[{'value':0,'result':0},{'value':1000,'result':1}]}],'sources':['BIPM SI prefix kilo']};ratio['signature']={'version':1,'name':'metresToKilometres','inputs':[{'path':'m','type':'number','unit':'m','domain':[0,1000000]}],'output':{'type':'number','unit':'km'}}
    ratio['procedures']=[{'version':1,'id':'ratio','kind':'affine','input':'m','domain':[0,1000000],'count':8,'seed':7919,'slope':1,'offset':0,'tolerance':1e-9,'unit':'km'}]
    ratio['cases']=[{'id':'arithmetic-contradiction','inputs':{'m':1000},'expect':1000,'unit':'km','tolerance':1e-9}]
    pipeline.write(run/'ratio-old.json',ratio);pipeline.quality('freeze',run/'ratio-old.json',run/'ratio-old-frozen.json');old_digest=sha(run/'ratio-old-frozen.json')
    requirement={'caseId':'arithmetic-contradiction','referenceKey':'metresToKilometres','inputs':{'m':1000},'unit':'km','expect':1000,'tolerance':1e-9}
    challenge=catalog.challenge(run/'challenge.json',run/'ratio-old-frozen.json',requirement,evidence,registry)
    assert challenge['action']=='new-eval-version-required'
    for wrong in [dict(requirement,unit='psi'),dict(requirement,inputs={'m':1001}),dict(requirement,referenceKey='oxygenPressure')]:
        try:catalog.challenge(run/(uuid.uuid4().hex+'.json'),run/'ratio-old-frozen.json',wrong,evidence,registry);raise AssertionError('irrelevant evidence accepted')
        except ValueError:pass
    ratio['procedures'][0]['slope']=.001;ratio['cases'][0]['expect']=1
    pipeline.write(run/'ratio-new.json',ratio);pipeline.quality('freeze',run/'ratio-new.json',run/'ratio-new-frozen.json')
    assert sha(run/'ratio-old-frozen.json')==old_digest and sha(run/'ratio-new-frozen.json')!=old_digest
    summary={'version':1,'passed':True,'scope':'deterministic development controls; test-only writer hashes, not Gate A or complete live cycle','wasmSourceCases':rows,'catalogCompatibleReuse':True,'catalogWrongSemanticsUnitReferenceMiss':True,'minimalRepairPreservedFreeze':True,'repairDisputeAndRetryDenied':True,'challengeActualSourceRelevant':True,'challengeWrongClaimDenied':True,'requestBindingEnforced':True,'evidenceRoot':str(run)}
    target=C/'control'/('integration-debug-'+run.name+'.json');target.write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({'passed':True,'wasmSourceControls':len(rows),'receipt':str(target)}))


if __name__=='__main__':main()
