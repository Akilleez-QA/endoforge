"""Manifest admission must reject malformed inputs before model/service cost."""
import copy,json,tempfile
from pathlib import Path
from unittest.mock import patch
from tools.factory_campaign import cli,pipeline as p

def main():
    base=json.loads((p.REPO/'campaigns/next50-20261018/control/runner-example.json').read_text());checks=[]
    with tempfile.TemporaryDirectory(prefix='endoforge-cli-admission-')as temporary:
        root=Path(temporary)
        for index,mutation in enumerate([lambda s:s.update(version=99),lambda s:s.update(modelFamily='claude'),lambda s:s.update(referenceSourceSha256='0'*64),lambda s:s['signature'].update(inputs=[])]):
            spec=copy.deepcopy(base);mutation(spec);file=root/f'{index}.json';file.write_text(json.dumps(spec))
            with patch.object(cli,'start',side_effect=AssertionError('must not launch provider'))as provider:
                try:cli.run(file,root/f'run-{index}');raise AssertionError('malformed input admitted')
                except (ValueError,RuntimeError):pass
                assert not provider.called
            checks.append('invalid-'+str(index))
        spec=copy.deepcopy(base);authority={'request':spec['request'],'signature':spec['signature'],'reference':{'kind':'unknown','slope':1,'offset':0}};source=root/'reference.json';source.write_text(json.dumps([authority]));spec.update(referenceSource=str(source),referenceSourceSha256=p.digest(source),referenceIndex=0);file=root/'kind.json';file.write_text(json.dumps(spec))
        with patch.object(cli,'start',side_effect=AssertionError('must not launch provider'))as provider:
            try:cli.run(file,root/'kind-output');raise AssertionError('unknown reference kind admitted')
            except ValueError:pass
            assert not provider.called
        checks.append('unknown-reference-kind')
        spec=copy.deepcopy(base);spec['request']['artifactClass']='workflow';file=root/'unsupported.json';file.write_text(json.dumps(spec))
        with patch.object(cli,'start',side_effect=AssertionError('must not launch provider'))as provider:
            result=cli.run(file,root/'unsupported-output');assert result['outcome']=='unsupported'and result['allAssigned']==1 and not provider.called
        checks.append('unsupported-retained-without-model')
    print(json.dumps({'passed':True,'noModelCalls':True,'checks':checks}))

if __name__=='__main__':main()
