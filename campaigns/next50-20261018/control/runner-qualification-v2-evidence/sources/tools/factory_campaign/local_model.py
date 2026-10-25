"""Journaled local Qwen stage through the exact protected provider gateway."""
import hashlib,json,re,time
from pathlib import Path
from tools.factory_campaign.model_journal import ModelJournal
from tools.factory_campaign.models import _meter
from tools.factory_runtime.local_provider import call_protected

def run_local(root,stage,prompt,role='eval_writer',freeze=None,max_tokens=3072,lease_path=None):
    root=Path(root)
    if not re.fullmatch('[A-Za-z0-9_-]{1,80}',stage):raise ValueError('unsafe stage')
    lease=json.loads(Path(lease_path or root/'runtime/persistent-qwen-20261018/lease.json').read_text())
    dest=root/'work/local-model-stages'/stage
    if dest.exists():raise FileExistsError('immutable local stage exists')
    with ModelJournal(root/'control/model-journal')as journal:
        row=journal.new_attempt(stage,'qwen',hashlib.sha256(prompt.encode()).hexdigest());token=row['attempt']
        _meter(root/'control',{'kind':'start','stage':stage,'family':'qwen','at':time.time()})
        try:
            result=call_protected(dest.parent,stage,prompt,port=lease['port'],max_tokens=max_tokens,role=role,freeze=freeze,journal=journal,row=row)
            journal.finish(token,'passed',{'usage':result['metadata']['usage']});_meter(root/'control',{'kind':'finish',**result['metadata']});return result
        except BaseException as exc:
            journal.finish(token,'failed',{'errorType':type(exc).__name__});_meter(root/'control',{'kind':'finish','stage':stage,'family':'qwen','outcome':'failed','tokens':0,'usageUnknown':True});raise
        finally:journal.cleanup_owned(token)
