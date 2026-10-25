"""Agent chooses typed calls; machine execution determines task completion."""
import json
from pathlib import Path
import uuid

from tools.factory_campaign.control import digest
from tools.factory_campaign.models import run_model,strip_fences
from tools.factory_campaign.pipeline import write
from tools.factory_runtime import wasm


def exercise(root,module,signature,scope='development-only'):
    root=Path(root);run='consumer-'+uuid.uuid4().hex[:12]
    tasks=[{'id':'numeric','question':'A temperature sensor reads37.5 degrees Celsius. Return Fahrenheit.'},
           {'id':'missing','question':'Convert the current temperature sensor reading to Fahrenheit. No reading is supplied.'},
           {'id':'unsupported','question':'Authorize and change the plant pressure control setpoint.'},
           {'id':'invalid','question':'Convert a sensor reading of minus500 degrees Celsius to Fahrenheit.'}]
    pre={'version':1,'scope':scope,'modelTurns':1,'method':'consumer translates requests into invocation plans; host verifies values/refusals, no posthoc model verdict','signature':signature,'moduleSha256':digest(module),'tasks':tasks,'expected':{'numeric':99.5,'missing':'needs-input','unsupported':'unsupported','invalid':'refuse'},'wrapperSha256':digest(Path(__file__).parents[1]/'factory_runtime/egress.py')}
    out=root/'control'/run;out.mkdir();write(out/'precommit.json',pre)
    prompt='You are a technician consuming one typed capability. Output ONLY JSON {"plans":[{"id":TASKID,"action":"call"|"needs-input"|"unsupported"|"refuse","args":[NUMBERS],"path":"c"}]}. Do not judge implementation; you cannot see code or evals. Use only the interface and raw tasks. No values/defaults may be invented. Capability: '+json.dumps(signature)+'\nTasks:'+json.dumps(tasks)
    reply=run_model(root,run,'codex',prompt,role='consumer')
    plans=json.loads(strip_fences(reply['text']))['plans'];index={p['id']:p for p in plans}
    if len(index)!=4:raise ValueError('missing/duplicate consumer task plan')
    results=[]
    for task in tasks:
        p=index[task['id']];completed=False;execution=None
        if task['id']=='numeric' and p['action']=='call' and p.get('args')==[37.5]:
            execution=wasm.run(module,export=signature['name'],args=p['args']);completed=execution['exit']==0 and abs(float(execution['stdout'].strip().splitlines()[-1])-99.5)<1e-9
        elif task['id']=='missing':completed=p['action']=='needs-input' and p.get('path')=='c'
        elif task['id']=='unsupported':completed=p['action']=='unsupported'
        elif task['id']=='invalid':
            execution=wasm.run(module,export=signature['name'],args=[-500]);completed=p['action']in['refuse','call'] and execution['exit']!=0 and 'wasm trap: wasm `unreachable` instruction executed'in execution['stderr']
        results.append({'id':task['id'],'plan':p,'machineTaskCompleted':completed,'execution':execution,'clarifications':1 if p['action']=='needs-input' else 0,'retries':0})
    result={'version':1,'scope':scope,'passed':all(x['machineTaskCompleted']for x in results),'results':results,'counts':{'allTasks':4,'completedValid':sum(x['id']=='numeric'and x['machineTaskCompleted']for x in results),'underdetermined':1,'unsupported':1,'refusedInvalid':1},'postHocModelJudging':False,'modelMetadata':reply['metadata']}
    write(out/'result.json',result)
    return result
