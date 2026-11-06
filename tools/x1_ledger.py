import hashlib
import json
import sqlite3
import sys

from core.ledger.frozen import FrozenEvaluators
from core.ledger.ledger import Ledger
from tools.x1_loop import decide, refusal, store_decision

action = sys.argv[1]
r = json.load(sys.stdin)
ledger = Ledger(r['reference']['ledger']) if action != 'promote' else None


def append(kind, identity, data):
    return ledger.append(dict(version=0, kind=kind, id=identity, data=data))


if action == 'freeze':
    append('task', 'task', dict(intent=r['need'], acceptance='X1 G1-G7'))
    append('admitted_input', 'input', dict(task='task', content=r['need'], origin='caller'))
    frozen = FrozenEvaluators(ledger).freeze(r['reference']['root'], task='task', admitted_input='input',
        confirmed_by='freeze-before-code supervisor', qualification='X1 acceptance boundary',
        synthesis_context=dict(id='need', candidate_blind='confirmed', inputs=['input']),
        configuration=r['configuration'], residual='X1 G1-G7', invariant_version='1')
    print(json.dumps(dict(identity=frozen['id'], digest=frozen['data']['freeze']['digest'])))
elif action == 'register':
    content = r['content']
    identity = hashlib.sha256(content.encode()).hexdigest()
    append('candidate', identity, dict(task='task', admitted_input='input', content=content, proposer='configured generator'))
    print(json.dumps(identity))
elif action == 'promote':
    request = dict(reference=r['reference'], candidate=r['candidate'], receipt=r['receipt'])
    try:
        ledger = Ledger(r['reference']['ledger'])
        with sqlite3.connect(ledger.path) as db:
            db.execute('BEGIN IMMEDIATE')
            records, tip = ledger._read(db)
            stored = db.execute('SELECT hash FROM records WHERE id=?', (r['receipt']['id'],)).fetchone()
            decision = decide(records, tip, stored and stored[0], request)
    except (ValueError, KeyError, TypeError, sqlite3.Error):
        decision = refusal(dict(version=1, issuer='endoforge.local.x1', policy='X1-G1-G7/v1', scope='qualification',
                                candidate=r['candidate'], frozen_evaluator=r['reference']['identity'], receipt=r['receipt']))
    store_decision(decision, r['decisionPath'])
    print(json.dumps(decision))
else:
    raise ValueError('unknown action')
