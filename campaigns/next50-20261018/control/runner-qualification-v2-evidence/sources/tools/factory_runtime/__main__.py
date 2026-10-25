import argparse,json
from .core import validate_spec
from .runner import run_attempt
from .recovery import reconcile
p=argparse.ArgumentParser();p.add_argument('action',choices=['run','reconcile']);p.add_argument('root');p.add_argument('spec_or_attempt');a=p.parse_args()
if a.action=='run':
 s=validate_spec(json.load(open(a.spec_or_attempt)))
 r=run_attempt(a.root,s['attempt'],s['job'],s['input'],s['inputSha256'],s['expectedSha256'],s['script'],s['timeoutSeconds'])
else:r=reconcile(a.root,a.spec_or_attempt)
print(json.dumps(r))
