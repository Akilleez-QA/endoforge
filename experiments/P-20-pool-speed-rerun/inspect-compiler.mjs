import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const asc = process.env.P20_ASC ?? '/tmp/ef-p20-setup/p15/node_modules/assemblyscript/dist/asc.js';
const source = fs.readFileSync(path.join(path.dirname(asc), 'assemblyscript.js'), 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = [...source.matchAll(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/g)].map(match => {
  const bytes = Buffer.from(match[1], 'base64');
  let offset = 8;
  const uint = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  const memories = [];
  while (offset < bytes.length) {
    const section = bytes[offset++], size = uint(), end = offset + size;
    if (section === 5) for (let n = uint(); n; n--) {
      const flags = uint(), initialPages = uint(), maximumPages = flags & 1 ? uint() : null;
      memories.push({ flags, initialPages, maximumPages });
    }
    offset = end;
  }
  return { bytes: bytes.length, sha256: sha(bytes), memories };
});
console.log(JSON.stringify({ source: 'assemblyscript/dist/assemblyscript.js', sourceSha256: sha(source), method: 'static decode of embedded WASM, no execution',
  modules, finding: 'The imported f64_pow helper has no declared memory maximum; the pool rejects omitted maxima before allocation.' }));
