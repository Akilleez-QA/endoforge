import hashlib
import json
import sqlite3
import sys

from core.ledger.frozen import FrozenEvaluators
from core.ledger.ledger import Ledger
from tools.x1_loop import FREEZE_FACTS, GATE_LABEL, POLICY, decide, refusal, sealed, store_decision

ACTIONS = ('freeze', 'register', 'promote')
USAGE = 'usage: python3 -B -m tools.x1_ledger freeze|register|promote < request.json'


def freeze(r, ledger):
    ledger.append(dict(version=0, kind='task', id='task', data=dict(intent=r['need'], acceptance=GATE_LABEL)))
    ledger.append(dict(version=0, kind='admitted_input', id='input', data=dict(task='task', content=r['need'], origin='caller')))
    frozen = FrozenEvaluators(ledger).freeze(r['reference']['root'], task='task', admitted_input='input', **FREEZE_FACTS,
        configuration=r['configuration'], residual=GATE_LABEL, invariant_version='1')
    return dict(identity=frozen['id'], digest=frozen['data']['freeze']['digest'])


def register(r, ledger):
    content = r['content']
    identity = hashlib.sha256(content.encode()).hexdigest()
    ledger.append(dict(version=0, kind='candidate', id=identity,
                       data=dict(task='task', admitted_input='input', content=content, proposer='configured generator')))
    return identity


def promote(r):
    request = dict(reference=r['reference'], candidate=r['candidate'], receipt=r['receipt'])
    try:
        ledger = Ledger(r['reference']['ledger'])
        with sqlite3.connect(ledger.path) as db:
            db.execute('BEGIN IMMEDIATE')
            records, tip = ledger._read(db)
            stored = db.execute('SELECT hash FROM records WHERE id=?', (r['receipt']['id'],)).fetchone()
            decision = decide(records, tip, stored and stored[0], request)
    except (ValueError, KeyError, TypeError, sqlite3.Error) as error:
        decision = refusal(dict(version=1, issuer='endoforge.local.x1', policy=POLICY, scope='qualification',
                                candidate=r['candidate'], frozen_evaluator=r['reference']['identity'], receipt=r['receipt']))
        if isinstance(error, sqlite3.OperationalError):
            decision.pop('sha256')
            decision.update(decision='inconclusive', reason='the ledger was unavailable; nothing was decided about the candidate')
            decision = sealed(decision)
    store_decision(decision, r['decisionPath'])
    return decision


def main(arguments):
    if len(arguments) != 1 or arguments[0] not in ACTIONS:
        print(USAGE, file=sys.stderr)
        return 2
    action = arguments[0]
    r = json.load(sys.stdin)
    if action == 'promote':
        print(json.dumps(promote(r)))
    else:
        print(json.dumps((freeze if action == 'freeze' else register)(r, Ledger(r['reference']['ledger']))))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
