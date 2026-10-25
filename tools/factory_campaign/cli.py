"""Run one manifest-driven Codex/Qwen scalar job under existing factory controls."""
import argparse,copy,json,math,sys,uuid
from pathlib import Path
from tools.factory_campaign import pipeline as p
from tools.factory_campaign.execute50 import PROTOCOL,digest_obj
from tools.factory_campaign.models import run_model,strip_fences
from tools.factory_campaign.local_model import run_local
from tools.factory_runtime.lease_local_qwen import start,stop


def run(spec_path,output):
    spec_path=Path(spec_path).resolve();spec=json.loads(spec_path.read_text());root=Path(output).resolve();root.mkdir(parents=True,exist_ok=False);(root/'.gitignore').write_text('work/\n');lease=None
    try:
        if spec.get('version')!=1:raise ValueError('unknown manifest version')
        if set(spec)-{'version','request','signature','referenceSource','referenceSourceSha256','referenceIndex','scope'}:raise ValueError('unknown manifest field')
        request=spec['request'];signature=spec['signature'];p.write(root/'control/manifest.json',spec)
        if not p.valid_id(request.get('id')):raise ValueError('unsafe request identifier')
        if request['artifactClass']!='closed-form':
            result={'version':1,'outcome':'unsupported','allAssigned':1,'published':False,'reason':'Only the qualified scalar computation backend is executable; request retained.'};p.write(root/'result.json',result);return result
        if len(signature['inputs'])!=1 or signature['inputs'][0]['type']!='number' or signature['output']['type']!='number':raise ValueError('unsupported numeric ABI')
        p.write(root/'control/request.json',request);p.write(root/'control/signature.json',signature)
        p.quality('validate','request',root/'control/request.json');p.quality('validate','signature',root/'control/signature.json')
        source=Path(spec['referenceSource'])
        if p.digest(source)!=spec['referenceSourceSha256']:raise ValueError('reference source changed')
        source_packet=json.loads(source.read_text());source_packet=source_packet if isinstance(source_packet,list)else source_packet['requests'];index=spec['referenceIndex']
        if type(index)is not int or not 0<=index<len(source_packet):raise ValueError('invalid reference index')
        authority=source_packet[index]
        if authority['request']!=request or authority['signature']!=signature:raise ValueError('reference request/signature binding mismatch')
        ref=authority['reference'];key=signature['inputs'][0]['path'];domain=signature['inputs'][0]['domain']
        if ref.get('kind')not in {'affine','threshold'}:raise ValueError('unsupported independent reference kind')
        for field in (['slope','offset']if ref['kind']=='affine'else['threshold','below','above']):
            if type(ref.get(field))not in[int,float]or not math.isfinite(ref[field]):raise ValueError('invalid finite reference coefficient')
        def value(x):return x*ref['slope']+ref['offset']if ref['kind']=='affine'else(ref['below']if x<ref['threshold']else ref['above'])
        view={'version':1,'request':{'id':request['id'],'raw':request['raw']},'signature':signature,'reference':None};tag=uuid.uuid4().hex[:10]
        p.write(root/'control/precommit.json',{'version':1,'manifestSha256':p.digest(spec_path),'maxModelCalls':3,'maxModelCallWallSeconds':180,'families':['codex','local-qwen'],'view':view,'generatorStartsAfterFreeze':True,'hostReferenceSourceSha256':spec['referenceSourceSha256'],'noPaidApi':True,'noClaudeCodeCLI':True})
        lease_root=root/'runtime/local-provider';lease_root.parent.mkdir(parents=True);lease=start(lease_root)
        procedures=[];cases=[];writers=[]
        for family in ['codex','qwen']:
            stage='eval-'+family+'-'+tag;prompt=PROTOCOL+p.canonical([view])
            reply=run_model(root,stage,'codex',prompt,role='eval_writer')if family=='codex'else run_local(root,stage,prompt,lease_path=lease_root/'lease.json')
            answer=json.loads(strip_fences(reply['text']));p.write(root/'control'/(family+'-writer.json'),answer);row=next(x for x in answer['requests']if x['id']==request['id']);row=copy.deepcopy(row)
            writers.append({'family':family,'viewHash':digest_obj(view),'outputHash':digest_obj(row)})
            for procedure in row['procedures']:procedure['id']=family+'-'+procedure['id'];procedures.append(procedure)
            for case in row['cases']:case['id']=family+'-'+case['id'];cases.append(case)
        bundle={'version':1,'request':request,'signature':signature,'writers':writers,'procedures':procedures,'cases':cases};job=root/'job';frozen,expanded=p.prepare(job,request,signature,bundle)
        outputs=[]
        for case in expanded:
            x=case['inputs'].get(key);valid=type(x)in[int,float]and math.isfinite(x)and domain[0]<=x<=domain[1]
            outputs.append({'caseId':case['id'],'value':value(x),'unit':signature['output']['unit']}if valid else{'caseId':case['id'],'error':{'path':key}})
        p.write(job/'reference-candidate.json',{'signature':signature,'outputs':outputs});quality=p.quality('check',job/'frozen.json',job/'reference-candidate.json',check=False)
        if not quality['passed']:raise ValueError('independent reference rejected eval suite; generator not started')
        reply=run_model(root,'generate-'+tag,'codex',p.maker_prompt(request,signature),role='generator',freeze={'version':1,'frozen':True,'suiteSha256':frozen['suiteHash']})
        p.add_candidate(job,reply['text']);result=p.verify_publish(root,job);result.update(allAssigned=1,manifestSha256=p.digest(spec_path),independentReferencePassed=True,modelFamilies=['codex','qwen']);p.write(root/'result.json',result);return result
    except BaseException as exc:
        p.write(root/'failure.json',{'version':1,'outcome':'failed','published':False,'errorType':type(exc).__name__,'error':str(exc),'allAssigned':1});raise
    finally:
        if lease:stop(root/'runtime/local-provider')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('manifest');parser.add_argument('--output',required=True);args=parser.parse_args()
    result=run(args.manifest,args.output);print(json.dumps(result));return 0 if result.get('published')else 2

if __name__=='__main__':raise SystemExit(main())
