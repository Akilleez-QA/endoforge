"""Verify v2 snapshots only; does not run models or rewrite original evidence."""
import hashlib,json,stat
from pathlib import Path
B=Path(__file__).resolve().parent;R=B.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
packetpath=R/'campaigns/next50-20261018/control/runner-qualification-v2.json';packet=json.loads(packetpath.read_text());assert sha(packetpath)==(B/'packet.sha256').read_text().split()[0]
manifest=R/packet['manifest']['path'];assert sha(manifest)==packet['manifest']['sha256'];rows=json.loads(manifest.read_text())['files']
for relative,expected in rows.items():
 p=B/relative;assert not p.is_symlink()and p.is_file();assert sha(p)==expected,relative;assert not p.stat().st_mode&0o222,relative
old=R/packet['originalV1']['path'];assert sha(old)==packet['originalV1']['sha256'];assert packet['chronology']['allCurrentCodeMeasuredBeforeComparison']is False
assert json.loads((B/'resource-inventory.json').read_text())['allOwnedRuntimeUnitsStopped']
print(json.dumps({'passed':True,'snapshotFilesVerified':len(rows),'v1Unchanged':True,'postcomparisonChronologyDisclosed':True,'modelCalls':0}))
