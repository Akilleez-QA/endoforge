"""Real controller-kill metadata checks; not a live campaign recovery claim."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from tools.factory_campaign import state


def main():
    root=Path(os.environ['ENDOFORGE_TEST_OUTPUT'])/'state-controls'
    root.mkdir(parents=True,exist_ok=True);rows=[]
    for boundary in ['event-durable','snapshot-durable']:
        d=Path(tempfile.mkdtemp(prefix=boundary+'-',dir=root))
        state.record(d,{'version':1,'job':'crash-test','stage':'frozen','completed':['eval','freeze']})
        code="from tools.factory_campaign import state;import os,signal,sys;state.record(sys.argv[1],{'version':1,'job':'crash-test','stage':'generated','completed':['eval','freeze','generate']},fault=lambda s:os.kill(os.getpid(),signal.SIGKILL) if s==sys.argv[2] else None)"
        process=subprocess.run([sys.executable,'-c',code,str(d),boundary])
        assert process.returncode==-signal.SIGKILL
        recovered=state.recover(d);assert recovered['stage']=='generated'
        (d/'state.json').write_text('{partial');assert state.recover(d)==recovered
        first=d/'state-events/00000001.json';first.write_text(first.read_text().replace('frozen','tampered'))
        try:state.recover(d);raise AssertionError('altered ancestor accepted')
        except ValueError:pass
        rows.append({'boundary':boundary,'exit':process.returncode,'latestStateRecovered':True,'partialSnapshotRepaired':True,'changedAncestorDenied':True,'path':str(d)})
    result={'passed':True,'scope':'metadata controller-kill checks, no hosted-model or power-loss claim','cases':rows}
    receipt=root/'state-recovery.json';receipt.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':True,'boundaries':len(rows),'receipt':str(receipt)}))


if __name__=='__main__':main()
