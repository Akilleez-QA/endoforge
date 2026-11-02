import hashlib
import json
import os
import sqlite3
from pathlib import Path
import sys

from core.ledger.frozen import FrozenEvaluators
from core.ledger.ledger import Ledger

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
    decision = dict(version=1, issuer='endoforge.local.x1', policy='X1-G1-G7/v1', scope='qualification',
                    candidate=r['candidate'], frozen_evaluator=r['reference']['identity'], receipt=r['receipt'])
    try:
        ledger = Ledger(r['reference']['ledger'])
        with sqlite3.connect(ledger.path) as db:
            db.execute('BEGIN IMMEDIATE')
            records, tip = ledger._read(db)
            candidate, receipt = records[r['candidate']], records[r['receipt']['id']]
            data = receipt['data']
            stored_hash = db.execute('SELECT hash FROM records WHERE id=?', (receipt['id'],)).fetchone()[0]
            if (candidate['kind'] != 'candidate' or hashlib.sha256(candidate['data']['content'].encode()).hexdigest() != candidate['id']
                    or receipt['kind'] != 'receipt' or stored_hash != r['receipt']['hash']
                    or data['candidate'] != candidate['id'] or data['frozen_evaluator'] != r['reference']['identity']
                    or data['delivery_state'] != 'finished' or data['outcome_state'] != 'passed'):
                raise ValueError('candidate or passing receipt binding differs')
            observation, = data['observations']
            report = observation['report']
            attempts = report['attempts']
            if (observation['status'] != 'completed' or report['stage'] != 'completed'
                    or report['frontier'] != [candidate['id']] or len(attempts) != 2
                    or report['frozen_evaluator'] != data['frozen_evaluator']
                    or report['evaluator_digest'] != data['precommit']['oracle_version']):
                raise ValueError('complete pool finalist evidence required')
            for round_number, attempt in enumerate(attempts):
                if (attempt['candidate'] != candidate['id'] or attempt['round'] != round_number
                        or attempt['stage'] != 'passed' or attempt['firstFailure'] is not None
                        or attempt['frozen_evaluator'] != data['frozen_evaluator']
                        or attempt['evaluator_digest'] != report['evaluator_digest']
                        or [x['check'] for x in attempt['results']] != ['schema', 'interface', 'bounds', 'determinism', 'forbidden_effects', 'residual']
                        or not all(check['passed'] is True for check in attempt['results'])):
                    raise ValueError('failed or incomplete evaluator round')
                residual, = [check for check in attempt['results'] if check['check'] == 'residual']
                x1 = json.loads(residual['reason'])
                gates = {'G1_frozen', 'G2_compiles', 'G3_exports', 'G4_tests', 'G5_deterministic', 'G6_bounded', 'G7_glue'}
                if x1['promotable'] is not True or set(x1['gates']) != gates or not all(g['ok'] is True for g in x1['gates'].values()):
                    raise ValueError('all seven gates must pass')
            decision.update(decision='promote', chain_tip=tip, evaluator_digest=report['evaluator_digest'])
    except (ValueError, KeyError, TypeError, sqlite3.Error):
        decision.update(decision='refuse', reason='unverified chain or incomplete passing pool evidence')
    decision['sha256'] = hashlib.sha256(json.dumps(decision, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    with Path(r['decisionPath']).open('x') as output:
        json.dump(decision, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())
    print(json.dumps(decision))
else:
    raise ValueError('unknown action')
