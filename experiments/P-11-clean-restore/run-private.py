#!/usr/bin/env python3
import hashlib, json, math, os, platform, shutil, statistics, subprocess, tarfile, time
from pathlib import Path
H=Path(__file__).resolve().parent; R=H/'receipt/private-run'; W=H/'work-private'; P=H.parent/'P-09-portable-campaign'; START=time.monotonic(); COMMANDS=[]
def write(name,obj):
 p=R/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,indent=2)+'\n')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def manifest(root):return {str(p.relative_to(root)):sha(p) for p in sorted(root.rglob('*')) if p.is_file()}
def cmd(argv,check=True,timeout=90):
 if time.monotonic()-START>600:raise RuntimeError('10 minute budget')
 if shutil.disk_usage(H).free<5*1024**3:raise RuntimeError('disk floor')
 t=time.monotonic(); row={'argv':[str(a) for a in argv]}
 try:
  c=subprocess.run(row['argv'],capture_output=True,text=True,timeout=timeout); row.update(exit=c.returncode,stdout=c.stdout,stderr=c.stderr)
 except subprocess.TimeoutExpired as e:
  row.update(exit=None,timeout=True,stdout=str(e.stdout),stderr=str(e.stderr));raise
 finally:
  row['wallMs']=(time.monotonic()-t)*1000;COMMANDS.append(row);write('commands.json',COMMANDS)
 if check and row['exit']:raise RuntimeError('command failed '+str(row)[-2500:])
 return row
def env():return {'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'kernel':platform.platform(),'cpu':next(l for l in Path('/proc/cpuinfo').read_text().splitlines() if l.startswith('model name')),'cpuCount':os.cpu_count(),'load':os.getloadavg(),'meminfo':Path('/proc/meminfo').read_text(),'freeBytes':shutil.disk_usage(H).free,'git':cmd(['git','-C',H,'rev-parse','HEAD'])['stdout'].strip(),'dockerd':cmd(['dockerd','--version'])['stdout'],'runnerSha256':sha(H/'run-private.py'),'precommitSha256':sha(H/'PRECOMMIT-private.md')}
def semantic(result):
 return {k:({g:{a:b for a,b in v.items() if a!='maxMs'} for g,v in value.items()} if k=='gates' else [{a:b for a,b in t.items() if a!='ms'} for t in value] if k=='tests' else value) for k,value in result.items() if k!='at'}
def verify(p,expected):
 if sha(p)!=expected:raise ValueError('archive SHA-256 mismatch')
def main():
 if W.exists() or (R/'env-before.json').exists():raise SystemExit('existing attempt preserved; refuses to write receipts')
 for line in (R/'precommit.sha256').read_text().splitlines():
  digest,name=line.split(maxsplit=1)
  if sha(H/name)!=digest:raise RuntimeError('precommit changed')
 W.mkdir();write('env-before.json',env())
 old=json.loads((P/'receipt/summary.json').read_text()); originals=manifest(P/'receipt')
 original_archive=cmd(['sudo','-n','sha256sum',P/'work/image.tar'])['stdout'].split()[0]
 image=W/'image.tar'
 with image.open('wb') as f:subprocess.run(['sudo','-n','cat',str(P/'work/image.tar')],stdout=f,check=True)
 inputs=W/'inputs.tar.gz';shutil.copy2(P/'work/inputs.tar.gz',inputs)
 verify(image,old['imageArchiveSha256']);verify(inputs,old['inputArchiveSha256'])
 with tarfile.open(image) as t:
  im=json.load(t.extractfile('manifest.json'))
  if len(im)!=1:raise RuntimeError('expected one archived image')
  config=t.extractfile(im[0]['Config']).read(); expected_image='sha256:'+hashlib.sha256(config).hexdigest()
 write('archives.json',{'imageSha256':sha(image),'inputSha256':sha(inputs),'imageBytes':image.stat().st_size,'inputBytes':inputs.stat().st_size,'manifest':im,'derivedImageId':expected_image,'copyCommand':['sudo','-n','cat',str(P/'work/image.tar')]})
 corrupt=W/'corrupt-inputs.tar.gz';shutil.copyfile(inputs,corrupt)
 with corrupt.open('r+b') as f:f.seek(32);b=f.read(1);f.seek(32);f.write(bytes([b[0]^255]))
 try:verify(corrupt,old['inputArchiveSha256']);raise RuntimeError('corruption accepted')
 except ValueError as e:write('negative-control.json',{'passed':True,'error':str(e),'stage':'before extraction, daemon launch and workload execution','sha256':sha(corrupt)})
 restored=W/'restored';restored.mkdir()
 with tarfile.open(inputs) as t:
  members=t.getmembers()
  if any(Path(m.name).is_absolute() or '..' in Path(m.name).parts or not (m.isfile() or m.isdir()) for m in members):raise RuntimeError('unsafe archive member')
  write('input-members.json',[{'name':m.name,'size':m.size,'mode':m.mode,'type':str(m.type)} for m in members]);t.extractall(restored,filter='data')
 actual=manifest(restored/'inputs'); expected=json.loads((P/'receipt/input-manifest.json').read_text())
 write('input-manifest.json',actual)
 if actual!=expected:raise RuntimeError('input manifest mismatch')
 (W/'daemon.json').write_text('{}\n'); sock=W/'docker.sock'; pidfile=W/'dockerd.pid';data=W/'daemon-data';ex=W/'daemon-exec'
 docker=['sudo','-n','docker','--host',f'unix://{sock}']; daemon_argv=['sudo','-n','dockerd','--config-file',str(W/'daemon.json'),'--host',f'unix://{sock}','--data-root',str(data),'--exec-root',str(ex),'--pidfile',str(pidfile),'--storage-driver=vfs','--feature=containerd-snapshotter=false','--bridge=none','--iptables=false','--ip6tables=false','--ip-forward=false','--ip-masq=false','--userland-proxy=false']
 daemon_argv += ['--containerd',str(W/'c.sock'),'--containerd-namespace=p11','--containerd-plugins-namespace=p11-plugins']
 write('daemon-launch.json',{'argv':daemon_argv,'initialPathsAbsent':not data.exists() and not ex.exists() and not sock.exists()})
 (W/'containerd.toml').write_text('version = 3\ndisabled_plugins = ["io.containerd.cri.v1.images", "io.containerd.cri.v1.runtime"]\n')
 cargv=['sudo','-n','containerd','--config',str(W/'containerd.toml'),'--root',str(W/'c-root'),'--state',str(W/'c-state'),'--address',str(W/'c.sock')]
 write('containerd-launch.json',{'argv':cargv,'rootInitiallyAbsent':not (W/'c-root').exists()})
 clog=(R/'containerd-output.txt').open('w');cproc=subprocess.Popen(cargv,stdout=clog,stderr=subprocess.STDOUT)
 deadline=time.monotonic()+15
 while not (W/'c.sock').exists():
  if cproc.poll() is not None or time.monotonic()>deadline:raise RuntimeError('private containerd startup failed')
  time.sleep(.1)
 cpid=int(cmd(['sudo','-n','ctr','--address',W/'c.sock','version','--format','json'],False)['stdout'] or '0') if False else None
 # Capture the exact direct child of sudo without touching the shared system containerd.
 cpid=int(cmd(['pgrep','-P',str(cproc.pid)])['stdout'].strip())
 log=(R/'daemon-output.txt').open('w');proc=subprocess.Popen(daemon_argv,stdout=log,stderr=subprocess.STDOUT); active=None; rows=[]; cleanup={} 
 try:
  deadline=time.monotonic()+30
  while time.monotonic()<deadline:
   if proc.poll() is not None:raise RuntimeError('private daemon exited; inspect daemon.log')
   if sock.exists() and cmd(docker+['info','--format','{{json .}}'],False,5)['exit']==0:break
   time.sleep(.25)
  else:raise RuntimeError('private daemon readiness timeout')
  empty_images=cmd(docker+['image','ls','-aq'])['stdout'].strip();empty_containers=cmd(docker+['ps','-aq'])['stdout'].strip();info=json.loads(cmd(docker+['info','--format','{{json .}}'])['stdout'])
  write('private-containerd-empty.txt.json',cmd(['sudo','-n','ctr','--address',W/'c.sock','--namespace','p11','images','ls']))
  if info['Containerd']['Address']!=str(W/'c.sock'):raise RuntimeError('containerd socket not private')
  write('empty-store.json',{'images':empty_images,'containers':empty_containers,'info':info})
  if empty_images or empty_containers or info['DockerRootDir']!=str(data):raise RuntimeError('store not private/empty')
  cmd(docker+['load','--input',image]);inspect=json.loads(cmd(docker+['image','inspect',expected_image])['stdout'])[0];write('loaded-image.json',inspect)
  if inspect['Id']!=expected_image:raise RuntimeError('derived image mismatch')
  out=restored/'inputs/candidates'
  for candidate in sorted(out.iterdir()):
   active=f'endoforge-p11-{os.getpid()}-{candidate.name.lower()}'
   args=docker+['run','--name',active,'--rm','--pull=never','--network=none','--read-only','--user',f'{os.getuid()}:{os.getgid()}','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=512m','--memory-swap=512m','--pids-limit=64','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--mount',f'type=bind,src={out},dst=/out','--entrypoint','/usr/local/bin/node',expected_image,'/bundle/campaigns/x1-spec-study/factory/gate.mjs','run',f'/out/{candidate.name}']
   row=cmd(args,False);result=json.loads((candidate/'result.json').read_text());digest=sha(candidate/'kernel.wasm');comparisons={}
   for arm in ['bubblewrap','docker','roundtrip']:
    prior=json.loads((P/f'receipt/{arm}/{candidate.name}.json').read_text());comparisons[arm]={'semanticMatch':semantic(result)==semantic(prior['result']),'wasmMatch':digest==prior['wasmSha256'],'exitMatch':row['exit']==prior['exit']}
   record={'id':candidate.name,'command':row,'result':result,'wasmSha256':digest,'comparisons':comparisons};write(f'replay/{candidate.name}.json',record);rows.append(record);active=None
   if not all(all(c.values()) for c in comparisons.values()):raise RuntimeError('replay mismatch')
   print(candidate.name+' matches all P09 arms',flush=True)
  cleanup['remainingContainers']=cmd(docker+['ps','-aq'])['stdout'].strip()
 finally:
  if active:cmd(docker+['rm','-f',active],False,15)
  if pidfile.exists():
   pid=int(pidfile.read_text());line=cmd(['sudo','-n','cat',f'/proc/{pid}/cmdline'],False)['stdout']
   if str(data) not in line:raise RuntimeError('refusing to stop daemon: identity mismatch')
   cleanup['daemonPid']=pid;cmd(['sudo','-n','kill','-TERM',str(pid)])
  try:proc.wait(timeout=25)
  except subprocess.TimeoutExpired:raise RuntimeError('private daemon stop timed out; manual cleanup needed')
  log.close()
  cline=cmd(['sudo','-n','cat',f'/proc/{cpid}/cmdline'])['stdout']
  if str(W/'c-root') not in cline:raise RuntimeError('containerd identity mismatch')
  cmd(['sudo','-n','kill','-TERM',str(cpid)]);cproc.wait(timeout=20);clog.close();cleanup['privateContainerdExited']=cproc.returncode==0
  cmd(['sudo','-n','rm','-rf','--',W/'c-root',W/'c-state'])
  cleanup['daemonReturnCode']=proc.returncode;cleanup['pidfileAbsent']=not pidfile.exists();cleanup['processExited']=proc.poll() is not None
  # Only generated private daemon state. Archives, restored data and receipts retained.
  cmd(['sudo','-n','rm','-rf','--',data,ex]);cleanup['stateRemoved']=not data.exists() and not ex.exists();write('cleanup.json',cleanup)
 original_archive_after=cmd(['sudo','-n','sha256sum',P/'work/image.tar'])['stdout'].split()[0]
 unchanged=originals==manifest(P/'receipt') and original_archive==original_archive_after and sha(P/'work/inputs.tar.gz')==old['inputArchiveSha256']
 durations=sorted(r['command']['wallMs'] for r in rows)
 summary={'label':'Recorded (probe)','passed':len(rows)==19 and unchanged and cleanup.get('remainingContainers')=='' and cleanup['processExited'] and cleanup['stateRemoved'],'candidates':len(rows),'testCount':sum(len(r['result'].get('tests',[])) for r in rows),'allThreePriorArmsMatch':True,'emptyPrivateImageStore':True,'derivedImageId':expected_image,'inputManifestMatch':True,'corruptionRejectedBeforeExecution':True,'sourceEvidenceUnchanged':unchanged,'sameHost':True,'elapsedSeconds':time.monotonic()-START,'replayTiming':{'n':len(durations),'medianMs':statistics.median(durations),'p95Ms':durations[math.ceil(.95*len(durations))-1],'minMs':min(durations),'maxMs':max(durations)}}
 write('env-after.json',env());write('summary.json',summary)
 if not summary['passed']:raise RuntimeError('acceptance failure')
 print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
