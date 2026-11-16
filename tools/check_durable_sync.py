"""Refuse direct disk syncs outside tools/durable.py.

Usage: python3 -I tools/check_durable_sync.py [PATH ...]

Lists tracked Python files under PATH (default: the whole checkout) with git ls-files, skips experiments/,
vendor/ and node_modules, and reports every call of os.fsync or os.fdatasync, and every use of
fcntl.F_FULLFSYNC, outside tools/durable.py and the self-contained scripts in ALLOWED. Prints file:line: text
and the fix for each one and exits 1, or exits 0 when there are none. Exits 2 when git ls-files fails.
"""
import re
import subprocess
import sys

PATTERN = re.compile(r'\bos\.(fsync|fdatasync)\s*\(|\bF_FULLFSYNC\b')
ALLOWED = {
    'tools/durable.py': 'the helper itself',
    'tools/check_durable_sync.py': 'this check',
    'tools/test_check_durable_sync.py': 'the check\'s tests',
    'tools/factory_portability/resume_stage.py': 'copied alone to a remote host and run there',
    'tools/job-locks/job-locks.py': 'a stand-alone script with no repository imports',
    'tools/approved_atoms.py': 'run as a stand-alone script with no repository imports',
    'tools/dump_list.py': 'self-contained, with no repository imports',
    'tools/factory_runtime/core.py': 'self-contained factory runtime, with no repository imports',
    'tools/factory_runtime/recovery.py': 'self-contained factory runtime, with no repository imports',
    'tools/factory_runtime/runner.py': 'self-contained factory runtime, with no repository imports',
    'tools/factory_campaign/state.py': 'self-contained factory campaign state, with no repository imports',
    'tools/factory_campaign/model_journal.py': 'self-contained factory campaign journal, with no repository imports',
}
SKIP = ('experiments/', 'vendor/', 'node_modules')
FIX = ('use sync_data, sync_file or sync_dir from tools/durable.py: they pick fdatasync, fsync or '
       'F_FULLFSYNC for the platform, so durability holds on Linux, macOS and Windows')


def findings(paths):
    files = subprocess.run(['git', 'ls-files', '--', *(paths or ['.'])], capture_output=True, text=True, check=True).stdout.split()
    found = []
    for path in files:
        if not path.endswith('.py') or path.startswith(SKIP) or path in ALLOWED:
            continue
        with open(path, encoding='utf-8') as handle:
            for number, line in enumerate(handle, 1):
                if PATTERN.search(line):
                    found.append(f'{path}:{number}: {line.strip()}')
    return found


def main(argv):
    try:
        found = findings(argv)
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        print(f'git ls-files failed: {error}', file=sys.stderr)
        return 2
    for item in found:
        print(item)
    if found:
        print(FIX)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
