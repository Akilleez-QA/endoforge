"""Trusted-local approved atoms; append-only JSONL, advisory locks, incremental replay.

Hashes bind content, not approver identity. Keep the store writable only by trusted
operators. POSIX local filesystem required; this is not a distributed database.
"""
import argparse
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path

KINDS = {'number', 'claim', 'asset_look', 'narration_line', 'safety_value'}
CONTENT = ('id', 'kind', 'value', 'provenance')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(atom):
    return hashlib.sha256(encoded({k: atom[k] for k in CONTENT}).encode()).hexdigest()


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


class Registry:
    def __init__(self, path):
        self.path = Path(path)
        self._offset, self._atoms, self._consumers = 0, {}, {}

    def _apply(self, row):
        if row.get('event') == 'consumer':
            if row.get('id') not in self._atoms or not nonempty(row.get('consumer')):
                raise ValueError('Invalid consumer record')
            self._consumers.setdefault(row['id'], set()).add(row['consumer'])
            return
        atom = row.get('atom', {})
        if (row.get('event') != 'atom' or not isinstance(atom, dict) or set(atom) != set(CONTENT) | {
                'approval', 'approved_by', 'approved_at', 'sha256'}):
            raise ValueError('Invalid atom record')
        if (not nonempty(atom['id']) or not isinstance(atom['kind'], str) or atom['kind'] not in KINDS or
                not nonempty(atom['provenance']) or atom['sha256'] != digest(atom)):
            raise ValueError('Invalid atom content or sha256')
        provenance = atom['provenance']
        if not (provenance == 'CoolProp' or
                any(provenance.startswith(p) and provenance[len(p):].strip()
                    for p in ('IIAR ', 'owner_signoff '))):
            raise ValueError('Expected CoolProp, IIAR <ref>, or owner_signoff <date>')
        if provenance.startswith('owner_signoff '):
            date.fromisoformat(provenance[len('owner_signoff '):])
        old = self._atoms.get(atom['id'])
        if old is None:
            valid = atom['approval'] == 'pending' and atom['approved_by'] is None and atom['approved_at'] is None
        else:
            valid = (old['sha256'] == atom['sha256'] and
                     (old['approval'], atom['approval']) in {
                         ('pending', 'approved'), ('pending', 'retired'), ('approved', 'retired')})
            if atom['approval'] == 'approved':
                valid = valid and nonempty(atom['approved_by']) and nonempty(atom['approved_at'])
                if valid:
                    valid = datetime.fromisoformat(atom['approved_at']).utcoffset() is not None
            else:
                valid = valid and all(atom[k] == old[k] for k in ('approved_by', 'approved_at'))
        if not valid:
            raise ValueError('Invalid approval transition; content is immutable')
        self._atoms[atom['id']] = atom

    @contextmanager
    def _session(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open('a+b') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            if os.fstat(stream.fileno()).st_size < self._offset:
                raise ValueError('Registry was truncated')
            stream.seek(self._offset)
            for line in stream:
                if not line.endswith(b'\n'):
                    raise ValueError('Incomplete registry record; operator recovery required')
                try:
                    self._apply(json.loads(line))
                except (KeyError, TypeError, AttributeError) as exc:
                    raise ValueError('Malformed registry record') from exc
                self._offset = stream.tell()
            yield stream

    def _append(self, stream, row):
        data = (encoded(row) + '\n').encode()
        self._apply(row)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            self._offset = stream.tell()
        except OSError:
            self._offset, self._atoms, self._consumers = 0, {}, {}
            raise

    def _get(self, atom_id):
        if atom_id not in self._atoms:
            raise ValueError(f'Unknown atom: {atom_id}')
        return self._atoms[atom_id]

    def get(self, atom_id):
        with self._session():
            return deepcopy(self._get(atom_id))

    def list_consumers(self, atom_id):
        with self._session():
            self._get(atom_id)
            return sorted(self._consumers.get(atom_id, ()))

    def register(self, atom_id, kind, value, provenance):
        atom = dict(id=atom_id, kind=kind, value=value, provenance=provenance,
                    approval='pending', approved_by=None, approved_at=None)
        atom['sha256'] = digest(atom)
        with self._session() as stream:
            self._append(stream, {'event': 'atom', 'atom': deepcopy(atom)})
        return atom

    def transition(self, atom_id, sha256, approval, approved_by=None):
        with self._session() as stream:
            atom = dict(self._get(atom_id))
            if atom['sha256'] != sha256:
                raise ValueError('Approval digest does not match content')
            atom['approval'] = approval
            if approval == 'approved':
                atom.update(approved_by=approved_by, approved_at=datetime.now(timezone.utc).isoformat())
            self._append(stream, {'event': 'atom', 'atom': atom})
            return deepcopy(atom)

    def resolve(self, refs, consumer):
        """Resolve an entire pinned batch, then register its consumer once per atom."""
        if not isinstance(refs, list) or not nonempty(consumer):
            raise ValueError('Expected atom reference list and named consumer')
        with self._session() as stream:
            atoms = []
            for ref in refs:
                if not isinstance(ref, dict) or set(ref) != {'id', 'sha256'} or not nonempty(ref['id']):
                    raise ValueError('Reference must contain id and sha256')
                atom = self._get(ref['id'])
                if atom['approval'] != 'approved' or atom['sha256'] != ref['sha256']:
                    raise ValueError(f'Atom is not approved at requested digest: {ref["id"]}')
                atoms.append(atom)
            for atom in atoms:
                if consumer not in self._consumers.get(atom['id'], ()):
                    self._append(stream, {'event': 'consumer', 'id': atom['id'], 'consumer': consumer})
            return deepcopy(atoms)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    add = sub.add_parser('add')
    add.add_argument('id')
    add.add_argument('kind', choices=sorted(KINDS))
    add.add_argument('value', help='JSON value (quote strings as JSON)')
    add.add_argument('provenance')
    for command in ('get', 'consumers', 'approve', 'retire'):
        cmd = sub.add_parser(command)
        cmd.add_argument('id')
        if command in ('approve', 'retire'):
            cmd.add_argument('sha256')
        if command == 'approve':
            cmd.add_argument('--by', required=True)
    args = parser.parse_args(argv)
    registry = Registry(args.store)
    try:
        if args.command == 'add':
            result = registry.register(args.id, args.kind, json.loads(args.value), args.provenance)
        elif args.command in ('approve', 'retire'):
            result = registry.transition(args.id, args.sha256,
                                         'approved' if args.command == 'approve' else 'retired', getattr(args, 'by', None))
        else:
            result = registry.get(args.id) if args.command == 'get' else registry.list_consumers(args.id)
        print(encoded(result))
        return 0
    except (ValueError, OSError) as exc:
        parser.exit(2, f'{exc}\n')


if __name__ == '__main__':
    raise SystemExit(main())
