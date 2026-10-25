"""Subscription model stages via the qualified runtime's namespace/egress boundary."""
import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import re
import hashlib

from tools.factory_campaign.model_journal import ModelJournal

from tools.factory_campaign.control import digest, token_count
from tools.factory_runtime import egress


def _meter(root, row):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    with (root/'model-meter.jsonl').open('a+') as f:
        fcntl.flock(f,fcntl.LOCK_EX);f.seek(0)
        rows=[json.loads(line) for line in f if line.strip()]
        if row['kind']=='start':
            if sum(r['kind']=='start' for r in rows)>=46:
                raise RuntimeError('parent model turn allocation exhausted (14 reserved to independent lanes)')
            if sum(r.get('tokens',0) for r in rows)>=1000000:
                raise RuntimeError('parent token allocation exhausted (500k reserved to lanes)')
        f.seek(0,os.SEEK_END);f.write(json.dumps(row)+'\n');f.flush();os.fsync(f.fileno())


def run_model(root, stage, family, prompt, timeout=180, role='eval_writer', freeze=None):
    root=Path(root)
    if family!='codex':raise ValueError('Only Codex CLI is enabled; Claude Code CLI is prohibited by user instruction')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',stage):raise ValueError('unsafe stage identifier')
    if (root/'work/model-stages'/stage).exists():raise FileExistsError('immutable stage already exists')
    with ModelJournal(root/'control/model-journal') as journal:
        row=journal.new_attempt(stage,family,hashlib.sha256(prompt.encode()).hexdigest())
        attempt=row['attempt'];dest=root/'work/model-stages'/stage
        try:
            result=_run_model(root,stage,family,prompt,timeout,role,freeze,journal,row)
            journal.finish(attempt,'passed',{'metadataSha256':digest(dest/'metadata.json')})
            return result
        except BaseException as exc:
            observed='failed'
            if (dest/'metadata.json').is_file():
                meta=json.loads((dest/'metadata.json').read_text())
                if meta.get('outcome')=='timeout':observed='timeout'
            journal.finish(attempt,observed,{'errorType':type(exc).__name__})
            raise
        finally:
            cleanup=journal.cleanup_owned(attempt)
            if dest.is_dir():
                (dest/'ownership.json').write_text(json.dumps({'journalRoot':str(journal.root),'attempt':attempt,'scope':row['scope']})+'\n')
                (dest/'scope-cleanup.json').write_text(json.dumps({'actions':cleanup['cleanup']})+'\n')
                (dest/'credential-cleanup.json').write_text(json.dumps({'temporaryHomeRemoved':not Path(row['temporary']).exists(),'credentialsInCheckpoint':False})+'\n')


def _run_model(root, stage, family, prompt, timeout, role, freeze, journal, row):
    """One immutable stage, raw output private, metadata publishable. No retry hidden."""
    root=Path(root);dest=root/'work/model-stages'/stage
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',stage):raise ValueError('unsafe stage identifier')
    dest.mkdir(parents=True,exist_ok=False)
    if family!='codex':raise ValueError('Only Codex CLI is enabled; Claude Code CLI is prohibited by user instruction')
    _meter(root/'control',{'kind':'start','stage':stage,'family':family,'at':time.time()})
    prompt_path=dest/'prompt.txt';prompt_path.write_text(prompt)
    home=journal.private_home(row['attempt']);temporary=home.parent
    proxy=None;argv=None;unit=None
    try:
        user=Path.home()
        credential='.codex/auth.json';(home/'.codex').mkdir()
        cli=[str(Path(shutil.which('codex')).resolve()),'exec','-s','read-only','--skip-git-repo-check','--ephemeral','--ignore-user-config','-m','gpt-6.1-sol','-c','web_search="disabled"','--json','-']
        shutil.copy2(user/credential,home/credential);(home/credential).chmod(0o600)
        proxy=egress.serve(temporary/'proxy.sock')
        command=['/bin/sh','-c','exec '+shlex.join(cli)+' < /in/request']
        argv=egress.role_worker_command(role,home,dest,temporary/'proxy.sock',command,inputs={'request':prompt_path},freeze=freeze)
        unit=row['scope'];argv[argv.index('--unit')+1]=unit.removesuffix('.scope')
        argv[argv.index('--unit'):argv.index('--unit')]=['-p','Description='+journal.scope_description(row['attempt'])]
        journal.started(row['attempt'])
        result=egress.run_bounded(argv,timeout=timeout,output_limit=1048576)
        (dest/'execution.json').write_text(json.dumps(result,indent=2)+'\n')
        usage={};text='';model_name=None
        if result['exit']==0:
            for line in result['stdout'].splitlines():
                try:item=json.loads(line)
                except json.JSONDecodeError:continue
                if item.get('type')=='turn.completed':usage=item.get('usage',{})
                msg=item.get('item',{})
                if item.get('type')=='item.completed' and msg.get('type')=='agent_message':text=msg.get('text','')
        meta={'version':1,'stage':stage,'family':family,'model':model_name,'exit':result['exit'],'outcome':result['outcome'],'wallMs':result['wallMs'],'usage':usage,'tokens':token_count(family,usage),'promptSha256':digest(prompt_path),'rawExecutionSha256':digest(dest/'execution.json'),'proxyEvents':proxy.events,'networkPolicy':'exact provider CONNECT allowlist/public pinned DNS; worker network namespace; no host/LAN route'}
        (dest/'metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
        _meter(root/'control',{'kind':'finish',**meta})
        if result['exit']!=0 or not usage or not text:
            raise RuntimeError(f'model stage failed: {stage}; see private execution receipt')
        (dest/'result.txt').write_text(text)
        return {'text':text,'metadata':meta,'stagePath':str(dest)}
    except BaseException as exc:
        (dest/'failure.json').write_text(json.dumps({'error':str(exc),'type':type(exc).__name__})+'\n')
        raise
    finally:
        if proxy:proxy.shutdown();proxy.server_close()


def strip_fences(text):
    text=text.strip()
    if text.startswith('```') and text.endswith('```'):
        text=text.split('\n',1)[1].rsplit('\n```',1)[0]
    return text.strip()
