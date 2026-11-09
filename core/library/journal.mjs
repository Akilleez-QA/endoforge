import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { canonical, sha256 } from './key.mjs';
export class Journal {
  #fd = null; #seq = 0; #tip = '0'.repeat(64); #memory; #path;
  constructor(path) {
    this.#memory = !path;
    this.#path = path;
    this.records = [];
    if (this.#memory) return;
    if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
      const { seq, previous, hash, body } = JSON.parse(line);
      if (seq !== this.#seq + 1 || previous !== this.#tip || sha256(`${seq}:${previous}:${body}`) !== hash) throw Error(`library journal chain failed at ${seq}`);
      this.#seq = seq; this.#tip = hash;
      this.records.push(JSON.parse(body));
    }
    this.#fd = openSync(path, 'a');
  }
  get tip() { return this.#tip; }
  append(record) {
    const body = canonical(record), seq = ++this.#seq, previous = this.#tip, hash = sha256(`${seq}:${previous}:${body}`);
    if (this.#fd !== null) { writeSync(this.#fd, `${JSON.stringify({ seq, previous, hash, body })}\n`); fsyncSync(this.#fd); }
    this.#tip = hash;
    return { seq, hash };
  }
  compact(transform) {
    if (this.#memory) return;
    const bodies = readFileSync(this.#path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(JSON.parse(line).body));
    const rows = [{ kind: 'library_compacted', previousSeq: this.#seq, previousTip: this.#tip }, ...bodies.map(transform)];
    let seq = 0, tip = '0'.repeat(64);
    const lines = rows.map(record => {
      const body = canonical(record), previous = tip, hash = sha256(`${++seq}:${previous}:${body}`);
      tip = hash;
      return JSON.stringify({ seq, previous, hash, body });
    });
    const next = `${this.#path}.compact`, fd = openSync(next, 'w');
    writeSync(fd, `${lines.join('\n')}\n`); fsyncSync(fd); closeSync(fd);
    closeSync(this.#fd);
    renameSync(next, this.#path);
    this.#fd = openSync(this.#path, 'a');
    this.#seq = seq; this.#tip = tip;
  }
  close() { if (this.#fd !== null) closeSync(this.#fd); this.#fd = null; }
}
