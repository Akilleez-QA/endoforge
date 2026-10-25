"""Postcomparison immutable evidence snapshot; no model calls or runtime changes."""
import datetime,hashlib,json,os,stat,subprocess,sys
from pathlib import Path
B=Path(__file__).resolve().parent;R=B.parents[3];C=R/'campaigns/next50-20261018/control';V1=C/'runner-qualification.json';V2=C/'runner-qualification-v2.json'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 with path.open('x') as f:json.dump(value,f,indent=2,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
def copy(source,dest):
 source=Path(source)
 if source.is_symlink()or not source.is_file():raise ValueError('copy only regular non-symlink files: '+str(source))
 first=sha(source);dest.parent.mkdir(parents=True,exist_ok=True)
 with dest.open('xb') as f:f.write(source.read_bytes());f.flush();os.fsync(f.fileno())
 if first!=sha(source)or first!=sha(dest):raise RuntimeError('source changed during snapshot: '+str(source))
 dest.chmod(0o444);return {'originalPath':str(source.relative_to(R)),'copyPath':str(dest.relative_to(R)),'sha256':first,'bytes':dest.stat().st_size}
def tree(source,dest):
 for p in sorted(source.rglob('*')):
  if p.is_symlink():raise ValueError('symlink in evidence tree '+str(p))
  if p.is_file():copy(p,dest/p.relative_to(source))
def stage():
 if (B/'staged.json').exists():raise FileExistsError('snapshot already staged')
 old=json.loads(V1.read_text());v1sha=sha(V1);copy(V1,B/'history/runner-qualification-v1.json');entries={};drift=[]
 for key,row in old['evidence'].items():
  source=R/row['path'];current=sha(source);drift.append({'key':key,'path':row['path'],'v1RecordedSha256':row['sha256'],'currentSha256':current,'drifted':current!=row['sha256']})
  if key=='localRoleJournal':source=R/'campaigns/next50-20261018/runtime/local-journal-0b4796f5/qualification.json'
  entries[key]=copy(source,B/'evidence'/key/source.name)
 extra={
 'cliSummary':'campaigns/next50-20261018/control/cli-qualification-summary.json',
 'cliOperationalResult':'campaigns/next50-20261018/control/cli-qualification/result.json',
 'latestModelJournalResult':'campaigns/next50-20261018/quality/model-journal-f3a0a91ccb5f42d881229a88fc13dbff/result.json',
 'latestModelJournalManifest':'campaigns/next50-20261018/quality/model-journal-f3a0a91ccb5f42d881229a88fc13dbff/manifest.json',
 'latestModelJournalCleanup':'campaigns/next50-20261018/quality/model-journal-f3a0a91ccb5f42d881229a88fc13dbff/cleanup.json',
 'comparisonPrecommit':'campaigns/next50-20261018/control/comparison-precommit.json',
 'comparisonDecision':'campaigns/next50-20261018/control/decision.json',
 'holdoutResult':'campaigns/next50-20261018/control/holdout-result.json',
 'historicalAuthCorrection':'campaigns/next50-20261018/runtime/historical-auth-correction.json',
 'qwenLease':'campaigns/next50-20261018/runtime/persistent-qwen-20261018/lease.json'}
 for key,path in extra.items():entries[key]=copy(R/path,B/'evidence'/key/Path(path).name)
 for p in sorted((R/'campaigns/next50-20261018/runtime/persistent-qwen-20261018').glob('stopped-*.json')):copy(p,B/'evidence/qwenLeaseCleanup'/p.name)
 trees={
 'actualWorkflow':'campaigns/next50-20261018/runtime/actual-workflow-recovery-6595fe3e',
 'modelController':'campaigns/next50-20261018/runtime/model-recovery-0be33dfd',
 'localJournal':'campaigns/next50-20261018/runtime/local-journal-0b4796f5'}
 for key,path in trees.items():tree(R/path,B/'raw'/key)
 state=json.loads((R/old['evidence']['stateJournal']['path']).read_text())
 for i,case in enumerate(state['cases']):tree(Path(case['path']),B/'raw/stateJournal'/str(i))
 sources={};sourceDrift=[]
 for folder in ['tools/factory_runtime','tools/factory_campaign']:
  for p in sorted((R/folder).rglob('*')):
   if p.is_file()and '__pycache__'not in p.parts and p.suffix in ['.py','.json','.md']:
    rel=str(p.relative_to(R));sources[rel]=copy(p,B/'sources'/rel)['sha256'];prior=old.get('sources',{}).get(rel)
    sourceDrift.append({'path':rel,'v1Sha256':prior,'currentSha256':sources[rel],'status':'same-as-v1'if prior==sources[rel]else'changed-since-v1'if prior else'not-recorded-in-v1'})
 for rel in ['tools/factory_quality/index.mjs','tools/factory_quality/cli.mjs','Makefile']:
  sources[rel]=copy(R/rel,B/'sources'/rel)['sha256']
 testmanifest=json.loads((B/'evidence/latestModelJournalManifest/manifest.json').read_text());assert testmanifest['helperSha256']==sources['tools/factory_campaign/model_journal.py'];assert testmanifest['testSha256']==sources['tools/factory_campaign/test_model_journal.py']
 assert sha(V1)==v1sha
 save(B/'staged.json',{'version':2,'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'v1Sha256':v1sha,'evidence':entries,'sources':sources,'v1EvidenceDrift':drift,'v1SourceComparison':sourceDrift,'modelJournalSourceMatchesLatest31CheckManifest':True})
 print(json.dumps({'staged':True,'evidenceEntries':len(entries),'sourceFiles':len(sources),'v1EvidenceDrift':[d['key']for d in drift if d['drifted']]}))
def finalize():
 staged=json.loads((B/'staged.json').read_text())
 if V2.exists():raise FileExistsError('v2 publication immutable')
 units=subprocess.run(['systemctl','--user','list-units','--all','--output=json','--no-pager','endoforge-*'],capture_output=True,text=True,check=True);parsed=json.loads(units.stdout)
 active=[u for u in parsed if u.get('active')in ['active','activating','deactivating','reloading']]
 docker=subprocess.run(['sudo','-n','docker','ps','-a','--filter','label=endoforge.runtime=v1','--format','{{json .}}'],capture_output=True,text=True,check=True)
 rows=[json.loads(line)for line in docker.stdout.splitlines()if line.strip()]
 if active or rows:raise RuntimeError('runtime resources still live: '+json.dumps({'units':active,'containers':rows}))
 lease=json.loads((B/'evidence/qwenLease/lease.json').read_text());check=subprocess.run(['systemctl','--user','show',lease['unit'],'--property=LoadState','--property=ActiveState','--property=Description'],capture_output=True,text=True,check=True)
 save(B/'resource-inventory.json',{'version':1,'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'allOwnedRuntimeUnitsStopped':True,'matchingUnits':parsed,'remainingRuntimeContainers':rows,'qwenLeaseState':check.stdout,'otherUserServicesUntouched':True,'modelCalls':0})
 assert sha(V1)==staged['v1Sha256'],'v1 modified externally'
 manifest={str(p.relative_to(B)):sha(p)for p in sorted(B.rglob('*'))if p.is_file()and p.name not in ['manifest.json','packet.sha256']}
 save(B/'manifest.json',{'version':1,'files':manifest})
 packet={'version':2,'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'postcomparison-qualification-evidence-refresh','packetIntegrityPassed':True,'recordedEvidenceStatus':'passed-in-each-stated-scope','scope':'synthetic one-input numeric local runner; no application deployment or whole-stack effectiveness inference','originalV1':{'path':str(V1.relative_to(R)),'sha256':staged['v1Sha256'],'unchanged':True,'immutableCopy':str((B/'history/runner-qualification-v1.json').relative_to(R))},'manifest':{'path':str((B/'manifest.json').relative_to(R)),'sha256':sha(B/'manifest.json'),'fileCount':len(manifest)},'evidence':staged['evidence'],'sources':staged['sources'],'v1EvidenceDrift':staged['v1EvidenceDrift'],'v1SourceComparison':staged['v1SourceComparison'],'resourceInventory':{'path':str((B/'resource-inventory.json').relative_to(R)),'sha256':sha(B/'resource-inventory.json')},'chronology':{'postComparisonRefresh':True,'comparisonPrecommitCopy':staged['evidence']['comparisonPrecommit']['copyPath'],'comparisonDecisionCopy':staged['evidence']['comparisonDecision']['copyPath'],'allCurrentCodeMeasuredBeforeComparison':False,'disclosure':'V2 freezes current evidence and current source bytes after comparison. V1 pointed to mutable state-recovery evidence whose hash drifted on later checks. Fresh CLI/ownership/source snapshots do not retroactively qualify every current line as tested or frozen before comparison.'},'boundaryCoverage':{'freeze':'append-only state metadata controller kills and snapshot recovery; no storage power-cycle','generationOwnership':'actual controllerSIGKILL around declared role wrapper with deterministic-test worker; unknown outcome cleanup and explicit fresh retry; no interrupted hosted model request resumed','verificationPublication':'real previously live-generated immutable candidate; owned Dockercompile orphan killed/reconciled; fresh boundedverification and onepublication; repeated knownpublication guard idempotent'},'newModelCalls':0,'checks':{'latestFactoryCheck':'parent reported make factory-check exit0 session94036; latest31-check model-journal result+manifest copied','latestModelJournalSourceHashMatchesManifest':staged['modelJournalSourceMatchesLatest31CheckManifest'],'newChecksPerformed':['copy/source hash identity','v1 unchanged','complete immutable-copy manifest verification','runtime service/container inventory']},'limitations':['No new model calls or comparisons','No power-loss test','Trusted host controls original evidence; copies are owner-read-only and content-hashed, not WORM storage','Live proof covers stated events/entry points only; no universal boundary or quality guarantee','V2 is an evidence refresh, not a preregistration amendment or adoption decision']}
 save(V2,packet);V2.chmod(0o444);(B/'packet.sha256').write_text(sha(V2)+'  '+str(V2.relative_to(R))+'\n');(B/'packet.sha256').chmod(0o444)
 for p in B.rglob('*'):
  if p.is_file():p.chmod(0o444)
 for p in sorted([p for p in B.rglob('*')if p.is_dir()],key=lambda p:len(p.parts),reverse=True):p.chmod(0o555)
 B.chmod(0o555);print(json.dumps({'published':str(V2.relative_to(R)),'packetSha256':sha(V2),'manifestFiles':len(manifest),'allServicesStopped':True}))
if __name__=='__main__':
 if sys.argv[1]=='stage':stage()
 elif sys.argv[1]=='finalize':finalize()
