"""No-model wiring controls; CLI/network are stubbed, never live qualification."""
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

from tools.factory_campaign import models

class Proxy:
    events=[]
    def shutdown(self):pass
    def server_close(self):pass

def main():
    rows=[]
    with tempfile.TemporaryDirectory(prefix='endoforge-model-wiring-') as tmp:
        root=Path(tmp);commands=[]
        try:models.run_model(root,'forbidden-family','claude','must not run');raise AssertionError('forbidden family enabled')
        except ValueError:pass
        assert not root.exists() or not list(root.iterdir())
        def command(*args,**kwargs):return ['systemd-run','--unit','replace-me','echo','stub']
        def copy(source,target):Path(target).write_text('deterministic fake credential; no authority')
        def execute(argv,**kwargs):
            commands.append(argv)
            return {'exit':0,'outcome':'passed','wallMs':1,'stdout':json.dumps({'type':'turn.completed','usage':{'input_tokens':1,'output_tokens':1}})+'\n'+json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'deterministic test output'}}),'stderr':''}
        with patch.object(models.egress,'serve',return_value=Proxy()),patch.object(models.egress,'role_worker_command',side_effect=command),patch.object(models.egress,'run_bounded',side_effect=execute),patch.object(models.shutil,'copy2',side_effect=copy):
            result=models.run_model(root,'wiring-control','codex','no model invoked')
            assert result['text']=='deterministic test output'
            dest=root/'work/model-stages/wiring-control';ownership=json.loads((dest/'ownership.json').read_text());attempt=ownership['attempt']
            state=json.loads((root/'control/model-journal/model-attempts'/attempt/'state.json').read_text())
            assert state['state']=='passed'and state['promotionAllowed']is False
            assert not Path(state['temporary']).exists()
            assert 'Description=endoforge-model-journal:'+attempt in commands[0]
            assert commands[0][commands[0].index('--unit')+1]==state['scope'].removesuffix('.scope')
            before=(dest/'ownership.json').read_bytes()
            try:models.run_model(root,'wiring-control','codex','duplicate');raise AssertionError('stage overwritten')
            except FileExistsError:pass
            assert (dest/'ownership.json').read_bytes()==before
            rows.append('success owned scope/private cleanup and immutable stage')
        def timeout(*args,**kwargs):return {'exit':-9,'outcome':'timeout','wallMs':1,'stdout':'','stderr':'deterministic timeout'}
        with patch.object(models.egress,'serve',return_value=Proxy()),patch.object(models.egress,'role_worker_command',side_effect=command),patch.object(models.egress,'run_bounded',side_effect=timeout),patch.object(models.shutil,'copy2',side_effect=copy):
            try:models.run_model(root,'timeout-control','codex','no model invoked');raise AssertionError('timeout accepted')
            except RuntimeError:pass
            ownership=json.loads((root/'work/model-stages/timeout-control/ownership.json').read_text())
            state=json.loads((root/'control/model-journal/model-attempts'/ownership['attempt']/'state.json').read_text())
            assert state['state']=='timeout'and not Path(state['temporary']).exists()
            rows.append('timeout retained without publication and private cleanup')
    print(json.dumps({'passed':True,'scope':'stubbed no-model wiring only','checks':rows}))

if __name__=='__main__':main()
