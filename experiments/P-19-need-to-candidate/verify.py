import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
encode = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
sha = lambda data: hashlib.sha256(data).hexdigest()
summary = json.loads((root / 'receipt/summary.json').read_text())
assert sha((root / 'PRECOMMIT.md').read_bytes()) == summary['precommit']
assert len(summary['runs']) == 60 and all(row['passed'] for row in summary['runs'])
files = sorted((root / 'receipt/raw').glob('*.json'))
assert len(files) == 60
for path in files:
    raw = json.loads(path.read_text())
    verification = raw['verification']
    previous = '0' * 64
    for index, record in enumerate(verification['engine_records'], 1):
        body = encode(record)
        previous = sha(f'{index}:{previous}:{body}'.encode('ascii'))
        assert verification['engine_hashes'][record['id']] == previous
    previous = None
    for record in verification['witnessed_records']:
        assert record['previous_id'] == previous
        body = {k: v for k, v in record.items() if k != 'record_id'}
        previous = sha(encode(body).encode('ascii'))
        assert record['record_id'] == previous
    name = path.stem
    manifest = json.loads((root / f'receipt/output/{name}.json').read_text())
    assert sha((root / f'receipt/output/{name}.mjs').read_bytes()) == manifest['candidate']
    assert manifest['realPromotion'] is False and manifest['synthetic'] is True
    assert raw['result']['report']['frontier'] == [manifest['candidate']]
for mode in ('thread', 'process'):
    rows = [row for row in summary['runs'] if row['isolation'] == mode]
    assert len(rows) == 30
    for stage, metric in summary['modes'][mode]['metrics'].items():
        values = sorted(row['totalMs'] if stage == 'totalMs' else row['stages'][stage] for row in rows)
        assert metric == dict(p50=values[14], p95=values[28])
print('60 raw runs; 120 independent chain hash replays; 60 artifact hashes; all percentiles verified')
