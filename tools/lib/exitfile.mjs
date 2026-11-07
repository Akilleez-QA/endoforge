import fs from 'node:fs';

const quote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

export const exitWrapper = (file) => `"$@"; code=$?; echo $code > ${quote(`${file}.tmp`)} && mv -f ${quote(`${file}.tmp`)} ${quote(file)}; exit $code`;

export function readExit(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  return /^\d+\s*$/.test(text) ? Number(text) : null;
}
