"""Exactly one allocated Codex subscription turn on the final wrapper."""
from pathlib import Path
import json,time
from . import core
from tools.factory_campaign.models import run_model
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime/final-codex-20261018'
def main():
 A.mkdir(exist_ok=False)
 prompt='Return only the integer 7. Do not use tools, external content, or files.'
 core.durable(A/'precommit.json',{'version':1,'createdBeforeCallUnix':time.time(),'modelCalls':1,'family':'codex','model':'gpt-6.1-sol','timeoutSeconds':180,'role':'consumer','promptSha256':__import__('hashlib').sha256(prompt.encode()).hexdigest(),'acceptance':'exit0,completed usage,exact text7,owned scope/temp cleanup; no paid fallback','sourceHashes':{str(p.relative_to(R)):core.digest(p) for p in Path(__file__).parent.glob('*.py')}})
 try:
  result=run_model(A,'exact-final-codex','codex',prompt,timeout=180,role='consumer')
  if result['text'].strip()!='7':raise AssertionError('model returned unexpected value')
  core.durable(A/'qualification.json',{'version':1,'passed':True,'text':result['text'].strip(),'metadata':result['metadata'],'stagePath':result['stagePath'],'limits':['one tiny subscription turn','no broad quality claim','no worker prompt confidentiality from trusted host claim']})
 except BaseException as e:
  core.durable(A/'qualification.json',{'version':1,'passed':False,'errorType':type(e).__name__,'error':str(e)});raise
 print(A)
if __name__=='__main__':main()
