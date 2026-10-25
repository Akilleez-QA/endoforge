#!/usr/bin/env python3
"""Synthetic harness controls only; these never count as N40 campaign evidence."""
import importlib.util,json,tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('resume',Path(__file__).with_name('resume_stage.py'));r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def main(bundle):
    with tempfile.TemporaryDirectory(prefix='endoforge-resume-controls-')as td:
        w=Path(td);c=w/'checkpoint';c.mkdir()
        (c/'module.wat').write_text('(module (func (export "twice") (param f64) (result f64) local.get 0 f64.const 0 f64.lt if unreachable end local.get 0 f64.const 2 f64.mul))')
        (c/'state.json').write_text(json.dumps({'job':'synthetic-harness-only','completedStages':['fixture'],'pendingStages':['verify']}))
        spec={'schema':'endoforge.portable-stage.v1','requiresModelAuthentication':False,'statePath':'state.json','modulePath':'module.wat','moduleSha256':r.sha(c/'module.wat'),'stage':'verify','cases':[{'id':'good','fn':'twice','args':[2],'expect':4,'tolerance':0},{'id':'refuse','fn':'twice','args':[-1],'expectError':True}]}
        (c/'resume.json').write_text(json.dumps(spec))
        def inventory():
            (c/'checkpoint.json').write_text(json.dumps({'schema':'endoforge.checkpoint.v1','files':{p.name:{'sha256':r.sha(p)}for p in c.iterdir()if p.name!='checkpoint.json'}}))
        inventory();a=r.run(c,bundle,w/'result');b=r.run(c,bundle,w/'result')
        assert a['passed']and a['published']and not a['reused']and b['reused']and not b['published']
        assert a['publicationSha256']==b['publicationSha256']and a['inputImmutable']and len(list((w/'result/attempts').glob('*.json')))==2
        spec['cases'][0]['expect']=5;(c/'resume.json').write_text(json.dumps(spec));inventory();bad=r.run(c,bundle,w/'failed')
        assert not bad['passed']and not bad['published']and not(w/'failed/stage.json').exists()
        return {'passed':True,'scope':'synthetic harness controls only','checks':['numeric outcome','explicit refusal','input immutability','single publication','idempotent second resume','new stage state','wrong expected outcome refused without publication'],'good':a,'duplicate':b,'wrong':bad}
if __name__=='__main__':
    import sys
    print(json.dumps(main(sys.argv[1]),indent=2))
