"""Local stand-in for the Docker CLI subset the factory runtime calls."""
import json
import os
import signal
import subprocess
import sys
import uuid
from pathlib import Path

VALUED = {'--name', '--label', '--user', '--log-opt', '--tmpfs', '--mount', '--entrypoint', '--format', '--filter'}


def fail(message):
    sys.stderr.write(message + '\n')
    raise SystemExit(1)


def load(state, name):
    path = state / (name + '.json')
    if not path.exists():
        fail('Error: No such object: ' + name)
    return path, json.loads(path.read_text())


def status(state, box):
    exit_file = state / (box['name'] + '.exit')
    if box.get('killed'):
        return {'Running': False, 'Status': 'exited', 'ExitCode': 137}
    if box.get('pid') is None:
        return {'Running': False, 'Status': 'created', 'ExitCode': 0}
    if exit_file.exists() and exit_file.read_text().strip():
        return {'Running': False, 'Status': 'exited', 'ExitCode': int(exit_file.read_text().strip())}
    return {'Running': True, 'Status': 'running', 'ExitCode': 0}


def options(args):
    found, rest, i = [], [], 0
    while i < len(args):
        if args[i] in VALUED:
            found.append((args[i], args[i + 1]))
            i += 2
        elif args[i].startswith('--') or args[i] in ('-aq', '-f'):
            found.append((args[i], None))
            i += 1
        else:
            rest = args[i:]
            break
    return found, rest


def main():
    state = Path(sys.argv[1])
    command, args = sys.argv[2], sys.argv[3:]
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'calls.jsonl').open('a') as log:
        log.write(json.dumps([command] + args) + '\n')
    found, rest = options(args)
    if command == 'create':
        name = dict(found)['--name']
        if (state / (name + '.json')).exists():
            fail('Conflict: container name in use')
        labels = dict(v.split('=', 1) for k, v in found if k == '--label')
        mounts = {}
        for k, v in found:
            if k == '--mount':
                fields = dict(x.split('=', 1) for x in v.split(',') if '=' in x)
                mounts[fields['dst']] = fields['src']
        box = {'name': name, 'id': uuid.uuid4().hex, 'labels': labels, 'mounts': mounts,
               'image': rest[0], 'script': rest[2], 'pid': None, 'options': [k for k, _ in found]}
        if os.environ.get('FAKE_DOCKER_OWNER'):
            box['labels']['endoforge.owner'] = os.environ['FAKE_DOCKER_OWNER']
        (state / (name + '.json')).write_text(json.dumps(box))
        print(box['id'])
    elif command == 'start':
        path, box = load(state, rest[0])
        script = box['script']
        for dst, src in box['mounts'].items():
            script = script.replace(dst, src)
        base = str(state / box['name'])
        wrapper = '(/bin/sh -c "$1") >"$2.stdout" 2>"$2.stderr"; echo $? >"$2.exit"'
        process = subprocess.Popen(['/bin/sh', '-c', wrapper, 'fake', script, base], start_new_session=True,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        box['pid'] = process.pid
        path.write_text(json.dumps(box))
    elif command == 'inspect':
        _, box = load(state, rest[0])
        current = status(state, box)
        if dict(found).get('--format') == '{{json .State}}':
            print(json.dumps(current))
        else:
            print(json.dumps([{'Id': box['id'], 'Name': '/' + box['name'],
                               'Config': {'Labels': box['labels'], 'Image': box['image']}, 'State': current}]))
    elif command == 'kill':
        path, box = load(state, rest[0])
        if box.get('pid'):
            try:
                os.killpg(box['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
        box['killed'] = True
        path.write_text(json.dumps(box))
    elif command == 'logs':
        _, box = load(state, rest[0])
        for stream, target in (('stdout', sys.stdout), ('stderr', sys.stderr)):
            source = state / (box['name'] + '.' + stream)
            if source.exists():
                target.write(source.read_text())
    elif command == 'rm':
        path, box = load(state, rest[0])
        if status(state, box)['Running'] and ('-f', None) not in found:
            fail('Error: container is running')
        if box.get('pid'):
            try:
                os.killpg(box['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
        path.unlink()
    elif command == 'ps':
        wanted = dict(found).get('--filter', '')
        name = wanted.removeprefix('name=^/').removesuffix('$')
        if (state / (name + '.json')).exists():
            print(json.loads((state / (name + '.json')).read_text())['id'])
    else:
        fail('unsupported fake docker command: ' + command)


if __name__ == '__main__':
    main()
