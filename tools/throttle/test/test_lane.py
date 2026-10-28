"""lane: a lane resumes after crashes and turns that end without DONE, moves to the next login on a usage limit
(taking its transcript), stops on DONE / NEEDS-YOU / STOP / --until, and keeps every event and its transcript on disk.
A fake `claude` plays each run from a script in the lane folder."""
import importlib.machinery
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

TOOL = pathlib.Path(__file__).resolve().parent.parent / 'lane'
LOADER = importlib.machinery.SourceFileLoader('lane_tool', str(TOOL))
SPEC = importlib.util.spec_from_loader('lane_tool', LOADER)
lane = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(lane)

# The fake claude: reads the run's action from <lane>/plan (one per line, consumed in order) and acts it out:
# crash | limit | turn (end without DONE) | done | needs. It always writes a stream event and a transcript line.
FAKE = r'''#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
sid = args[args.index('--resume') + 1] if '--resume' in args else args[args.index('--session-id') + 1]
prompt = sys.stdin.read()
d = os.environ['FAKE_LANE_DIR']
plan = open(os.path.join(d, 'plan')).read().split()
act, rest = plan[0], plan[1:]
open(os.path.join(d, 'plan'), 'w').write('\n'.join(rest))
tdir = os.path.join(os.environ['CLAUDE_CONFIG_DIR'], 'projects', re.sub(r'[/.]', '-', os.getcwd()))
os.makedirs(tdir, exist_ok=True)
with open(os.path.join(tdir, sid + '.jsonl'), 'a') as fh:
    fh.write(json.dumps({'login': os.path.basename(os.environ['CLAUDE_CONFIG_DIR']), 'act': act,
                         'resume': '--resume' in args, 'prompt': prompt[:40],
                         'note': 'note from the coordinator' in prompt}) + '\n')
print(json.dumps({'type': 'assistant', 'act': act}), flush=True)
if act == 'crash':
    sys.exit(3)
if act == 'limit':
    print(json.dumps({'type': 'result', 'is_error': True, 'result': "You've hit your monthly spend limit"}))
    sys.exit(1)
if act == 'done':
    open(os.path.join(d, 'DONE'), 'w').write('finished')
if act == 'needs':
    open(os.path.join(d, 'NEEDS-YOU'), 'w').write('which suit?')
print(json.dumps({'type': 'result', 'is_error': False, 'result': act}))
'''


class LaneRun(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = pathlib.Path(self.temp.name)
        self.job = root / 'job'
        self.job.mkdir()
        self.accts = root / 'accts'
        for x in ('a', 'b'):
            (self.accts / x).mkdir(parents=True)
        fake = root / 'claude'
        fake.write_text(FAKE)
        fake.chmod(0o755)
        self.d = pathlib.Path(lane.lane_dir(str(self.job), 'set'))
        self.d.mkdir(parents=True)
        (self.d / 'brief.md').write_text('Build the set.')
        self.state = {'name': 'set', 'job': str(self.job), 'unit': 'lane-job-set', 'session': 'sid-1',
                      'logins': ['a', 'b'], 'login': 'a', 'model': None, 'until': None, 'status': 'running',
                      'started': lane.stamp(), 'runs': 0, 'continues': 0, 'crashes': 0, 'begun': False}
        lane.write_json(str(self.d / 'state.json'), self.state)
        for p in (mock.patch.object(lane, 'ACCTS', str(self.accts)), mock.patch.object(lane, 'CLAUDE', str(fake)),
                  mock.patch.object(lane, 'notify', lambda *a: None), mock.patch.object(lane.time, 'sleep', lambda s: None),
                  mock.patch.dict(os.environ, {'FAKE_LANE_DIR': str(self.d), 'LANE_LIMIT_WAIT': '0'})):
            p.start()
            self.addCleanup(p.stop)

    def play(self, *acts):
        (self.d / 'plan').write_text('\n'.join(acts))
        lane.cmd_run(type('A', (), {'job': str(self.job), 'name': 'set'}))
        return json.loads((self.d / 'state.json').read_text())

    def transcript(self):
        return [json.loads(l) for l in (self.d / 'transcript.jsonl').read_text().splitlines()]

    def test_crash_and_early_turns_resume_the_same_session_until_done(self):
        st = self.play('crash', 'turn', 'done')
        self.assertEqual(st['status'], 'done')
        self.assertEqual((st['runs'], st['crashes'], st['continues']), (3, 1, 1))
        t = self.transcript()
        self.assertEqual([x['resume'] for x in t], [False, True, True])
        self.assertTrue(t[0]['prompt'].startswith('Build the set.'))
        self.assertIn('resumed by the lane tool', t[1]['prompt'])

    def test_every_event_is_on_disk(self):
        self.play('turn', 'done')
        stream = (self.d / 'stream.jsonl').read_text()
        self.assertEqual(stream.count('"type": "assistant"'), 2)
        events = [json.loads(l)['event'] for l in (self.d / 'events.jsonl').read_text().splitlines()]
        self.assertEqual(events, ['run', 'run', 'done'])

    def test_a_usage_limit_moves_the_session_and_its_transcript_to_the_next_login(self):
        st = self.play('turn', 'limit', 'done')
        self.assertEqual((st['login'], st['status']), ('b', 'done'))
        t = self.transcript()
        self.assertEqual([x['login'] for x in t], ['a', 'a', 'b'])   # b's copy begins with a's history
        self.assertTrue(t[2]['resume'])

    def test_needs_you_ends_the_lane(self):
        self.assertEqual(self.play('needs')['status'], 'needs-you')

    def test_stop_flag_and_until_end_the_lane(self):
        (self.d / 'STOP').write_text('x')
        self.assertEqual(self.play('turn')['status'], 'stopped')
        (self.d / 'STOP').unlink()
        st = dict(self.state, until='2000-01-01T00:00:00')
        lane.write_json(str(self.d / 'state.json'), st)
        self.assertEqual(self.play('turn')['status'], 'until-reached')

    def test_endless_turns_without_done_stop_and_ask(self):
        with mock.patch.object(lane, 'MAX_CONTINUES', 2):
            st = self.play('turn', 'turn', 'turn')
        self.assertEqual(st['status'], 'needs-you')


class Resume(LaneRun):
    def test_a_resume_note_reaches_the_lane_once(self):
        self.play('turn', 'done')
        os.rename(self.d / 'DONE', self.d / 'DONE.old')
        st = json.loads((self.d / 'state.json').read_text())
        st.update(status='running', note='Stills on CPU only.')
        lane.write_json(str(self.d / 'state.json'), st)
        st = self.play('turn', 'done')
        self.assertEqual(st['status'], 'done')
        self.assertIsNone(st['note'])
        self.assertEqual([x['note'] for x in self.transcript()], [False, False, True, False])
        self.assertTrue(all(x['resume'] for x in self.transcript()[1:]))


class Paths(unittest.TestCase):
    def test_unit_and_transcript_names(self):
        self.assertEqual(lane.unit_name('/mnt/x/abi-friday', 'set lane'), 'lane-abi-friday-set-lane')
        self.assertEqual(lane.transcript_slug('/home/a/.config/x'), '-home-a--config-x')


if __name__ == '__main__':
    unittest.main()
