import hashlib
import json
from pathlib import Path
import sys

from core.ledger.frozen import FrozenEvaluators
from core.ledger.ledger import Ledger

action = sys.argv[1]
r = json.load(sys.stdin)
ledger = Ledger(r['reference']['ledger'])


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
else:
    raise ValueError('unknown action')
