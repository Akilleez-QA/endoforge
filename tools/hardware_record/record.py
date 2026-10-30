import argparse
import hashlib
import json
import math
import os
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = json.loads(Path(__file__).with_name('schema.json').read_text())
TOOLS = ('python3', 'node', 'npm', 'rustc', 'cargo', 'gcc', 'clang', 'wasmtime', 'bwrap', 'systemctl', 'git')
THRESHOLDS = {'mean_busy_cores': 2.0, 'peak_busy_cores': 4.0, 'min_available_bytes': 4096 * 1024**2}


def read(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def command(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=5, env={**os.environ, 'LC_ALL': 'C'})
        return {'argv': args, 'exit': p.returncode, 'stdout': p.stdout.strip(), 'stderr': p.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {'argv': args, 'exit': None, 'stdout': '', 'stderr': type(e).__name__}


def snapshot():
    cpu = dict(line.split(':', 1) for line in read('/proc/cpuinfo').splitlines() if ':' in line)
    cpu = {k.strip(): v.strip() for k, v in cpu.items()}
    topology = {tuple(read(p / f) for f in ('physical_package_id', 'core_id')) for p in Path('/sys/devices/system/cpu').glob('cpu[0-9]*/topology')}
    disks = command(['lsblk', '-b', '-d', '-J', '-o', 'NAME,SIZE,TYPE,MODEL'])
    return {'hostname': platform.node(), 'cpu_model': cpu.get('model name', platform.machine()),
            'logical_cpus': os.cpu_count(), 'physical_cores': len(topology - {(None, None)}),
            'ram_bytes': memory()['MemTotal'], 'disks': json.loads(disks['stdout'])['blockdevices'],
            'os': platform.freedesktop_os_release()['PRETTY_NAME'], 'kernel': platform.release(),
            'firmware': {f: read('/sys/class/dmi/id/' + f) for f in ('bios_vendor', 'bios_version', 'bios_date')} | {'microcode': cpu.get('microcode')},
            'drivers': {p.parent.name: read(p) for p in sorted(Path('/sys/module').glob('*/version'))},
            'toolchain': {t: command([t, '--version']) for t in TOOLS},
            'boot_id': read('/proc/sys/kernel/random/boot_id')}


def memory():
    return {k: int(v.split()[0]) * 1024 for k, v in (line.split(':') for line in read('/proc/meminfo').splitlines())}


def counters():
    v = list(map(int, read('/proc/stat').splitlines()[0].split()[1:9]))
    return sum(v), v[3] + v[4]


def gate_result(samples, available):
    require(len(samples) == 5 and all(type(v) in (float, int) and math.isfinite(v) and v >= 0 for v in samples), 'invalid CPU samples')
    reasons = []
    if statistics.mean(samples) > THRESHOLDS['mean_busy_cores']:
        reasons.append('mean busy cores exceeds threshold')
    if max(samples) > THRESHOLDS['peak_busy_cores']:
        reasons.append('peak busy cores exceeds threshold')
    if available < THRESHOLDS['min_available_bytes']:
        reasons.append('available memory below threshold')
    return {'pass': not reasons, 'reasons': reasons, 'busy_cores': samples, 'available_bytes': available, 'thresholds': THRESHOLDS}


def quiet_gate():
    samples = []
    for _ in range(5):
        total, idle = counters()
        time.sleep(0.2)
        end, idle_end = counters()
        if end <= total:
            raise ValueError('CPU counters did not advance')
        samples.append(os.cpu_count() * (1 - (idle_end - idle) / (end - total)))
    return gate_result(samples, memory()['MemAvailable'])


def describe(xs):
    return {'samples_ns': xs, 'cv': statistics.stdev(xs) / statistics.mean(xs),
            'p95_over_median': sorted(xs)[math.ceil(.95 * len(xs)) - 1] / statistics.median(xs)}


def noise():
    original = os.sched_getaffinity(0)
    samples = {mode: {k: [] for k in ('compute', 'allocation', 'process_start')} for mode in ('pinned', 'unpinned')}
    try:
        for i in range(21):
            for mode in (('pinned', 'unpinned') if i % 2 else ('unpinned', 'pinned')):
                if memory()['MemAvailable'] < 256 * 1024**2 or os.getloadavg()[0] > 2 * len(original):
                    return {'status': 'refused', 'reason': 'capacity guard', 'samples': samples}
                os.sched_setaffinity(0, {min(original)} if mode == 'pinned' else original)
                for name, work in (('compute', lambda: sum(x*x for x in range(20000))), ('allocation', lambda: bytearray(1024**2)), ('process_start', lambda: subprocess.run([sys.executable, '-I', '-S', '-c', 'pass'], check=True, timeout=5))):
                    start = time.perf_counter_ns()
                    work()
                    if i:
                        samples[mode][name].append(time.perf_counter_ns() - start)
        return {'status': 'measured', 'pinned_cpu': min(original), 'unpinned_cpus': sorted(original), 'cells': {mode: {k: describe(v) for k, v in cells.items()} for mode, cells in samples.items()}}
    finally:
        os.sched_setaffinity(0, original)


def controls():
    cg = next(line[3:] for line in read('/proc/self/cgroup').splitlines() if line.startswith('0::'))
    base = Path('/sys/fs/cgroup') / cg.lstrip('/')
    results = {k: {'status': 'observed', 'enforced': None, 'source': str(base / k), 'readback': read(base / k)} for k in ('memory.max', 'pids.max', 'io.stat')}
    results['cgroup_controllers'] = {'status': 'observed', 'enforced': None, 'source': str(base / 'cgroup.controllers'), 'readback': read(base / 'cgroup.controllers')}
    affinity = command([sys.executable, '-I', '-S', '-c', 'import os; c=min(os.sched_getaffinity(0)); os.sched_setaffinity(0,{c}); print(sorted(os.sched_getaffinity(0))); assert os.sched_getaffinity(0)=={c}'])
    results['affinity'] = {'status': 'probed', 'enforced': affinity['exit'] == 0, 'probe': affinity}
    results['network_denial'] = {'status': 'not-tested', 'enforced': None, 'reason': 'Read-only inventory does not configure or claim network isolation.'}
    results['quiet_gate'] = quiet_gate()
    results['noise_baseline'] = noise()
    results['quiet_gate_after'] = quiet_gate()
    results['thermal'] = {'readings_millicelsius': {str(p): read(p) for p in sorted(Path('/sys/class/hwmon').glob('hwmon*/temp*_input'))}, 'note': 'Instantaneous sensors only; thermal steady state and throttling not qualified.'}
    return results


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def collect(out):
    out.mkdir(parents=True, exist_ok=False)
    write(out / 'precommit.json', {'thresholds': THRESHOLDS, 'runs_per_cell': 20, 'warmup': 1, 'subwindows': 5, 'subwindow_seconds': .2, 'compute_iterations': 20000, 'allocation_bytes': 1024**2, 'capacity_min_bytes': 256 * 1024**2, 'capacity_max_load_per_allowed_cpu': 2, 'source_sha256': digest(Path(__file__)), 'schema_sha256': digest(Path(__file__).with_name('schema.json'))})
    before = snapshot()
    write(out / 'before.json', before)
    probes = controls()
    write(out / 'controls.json', probes)
    after = snapshot()
    write(out / 'after.json', after)
    limits = ['Read-only inventory and diagnostic jitter only; no production isolation qualification.', 'memory.max, pids.max and controller readbacks are configuration observations; enforcement is untested.', 'Network denial, sustained thermal behaviour, firmware/driver completeness and C1-C7 calibration remain unqualified.']
    if not probes['quiet_gate']['pass'] or not probes['quiet_gate_after']['pass']:
        limits.append('Quiet gate refused; noise samples describe a busy machine.')
    changed = [k for k in SCHEMA['reopen_on'] if before[k] != after[k]]
    record = {'schema': SCHEMA['schema'], 'id': 'HQ-mainrig-' + datetime.now(timezone.utc).strftime('%Y%m%d'), 'created_at': datetime.now(timezone.utc).isoformat(), 'commit': command(['git', 'rev-parse', 'HEAD'])['stdout'], 'status': 'failed' if changed or not probes['affinity']['enforced'] or probes['noise_baseline']['status'] != 'measured' else 'qualified-with-limits', 'limits': limits + ([f'Environment changed: {changed}'] if changed else []), 'identity': before, 'controls': {k: 'controls.json#/' + k for k in SCHEMA['controls']}, 'receipts': {f: digest(out / f) for f in SCHEMA['receipt_files']}}
    write(out / 'record.json', record)
    validate(out)
    return record['status']


def require(ok, message):
    if not ok:
        raise ValueError(message)


def fields(value, spec):
    types = {'str': str, 'int': int, 'dict': dict, 'list': list}
    require(type(value) is dict and set(value) == set(spec), 'schema fields mismatch')
    for k, t in spec.items():
        require(type(value[k]) is types[t] and bool(value[k]), 'invalid field ' + k)


def validate(out, current=None):
    r = json.loads((out / 'record.json').read_text())
    fields(r, SCHEMA['required'])
    fields(r['identity'], SCHEMA['identity'])
    require(all(r['identity'][k] > 0 for k in ('logical_cpus', 'physical_cores', 'ram_bytes')), 'nonpositive hardware capacity')
    require(r['identity']['physical_cores'] <= r['identity']['logical_cpus'], 'invalid core topology')
    require(len(r['commit']) == 40 and all(c in '0123456789abcdef' for c in r['commit']), 'invalid commit')
    require(datetime.fromisoformat(r['created_at']).utcoffset() is not None, 'timestamp needs timezone')
    require(all(type(v) is str and v.strip() for v in r['limits']), 'invalid limits')
    require(r['schema'] == SCHEMA['schema'] and r['status'] in SCHEMA['statuses'], 'schema/status')
    require(r['status'] != 'qualified', 'read-only probes cannot fully qualify isolation')
    require(set(r['receipts']) == set(SCHEMA['receipt_files']), 'receipt set')
    for f, sha in r['receipts'].items():
        require(digest(out / f) == sha, 'receipt hash mismatch: ' + f)
    before, after, c = [json.loads((out / f).read_text()) for f in ('before.json', 'after.json', 'controls.json')]
    require(r['identity'] == before, 'identity differs from recorded receipt')
    require(set(r['controls']) == set(SCHEMA['controls']), 'missing controls')
    for k in SCHEMA['controls']:
        require(r['controls'][k] == 'controls.json#/' + k and k in c, 'control receipt: ' + k)
    for k in ('cgroup_controllers', 'memory.max', 'pids.max', 'io.stat', 'network_denial'):
        require(c[k]['enforced'] is None, 'unproven enforcement: ' + k)
    for key in ('quiet_gate', 'quiet_gate_after'):
        gate = c[key]
        require(gate == gate_result(gate['busy_cores'], gate['available_bytes']), 'quiet gate inconsistent')
    if r['status'] != 'failed':
        require(c['affinity']['enforced'] and c['affinity']['probe']['exit'] == 0, 'affinity failed')
        require(c['noise_baseline']['status'] == 'measured', 'noise missing')
        for mode in ('pinned', 'unpinned'):
            for k in ('compute', 'allocation', 'process_start'):
                cell = c['noise_baseline']['cells'][mode][k]
                xs = cell['samples_ns']
                require(len(xs) == 20 and all(type(v) is int and v > 0 for v in xs) and cell == describe(xs), 'invalid noise samples/statistics')
        require(all(before[k] == after[k] for k in SCHEMA['reopen_on']), 'environment changed; reopen')
    if current is not None:
        precommit = json.loads((out / 'precommit.json').read_text())
        require(precommit['source_sha256'] == digest(Path(__file__)) and precommit['schema_sha256'] == digest(Path(__file__).with_name('schema.json')), 'probe source changed; reopen')
        require(r['status'] != 'failed', 'failed qualification cannot be reused')
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(r['created_at'])).total_seconds()
        require(0 <= age <= 43200, 'record older than 12 hours; reopen')
        require(all(before[k] == current[k] for k in SCHEMA['reopen_on']), 'environment changed; reopen')
    return r


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('collect', 'validate', 'check-current'))
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    try:
        print(collect(args.directory) if args.action == 'collect' else validate(args.directory, snapshot() if args.action == 'check-current' else None)['status'])
    except (ValueError, OSError, KeyError, TypeError) as e:
        parser.exit(1, str(e) + '\n')
