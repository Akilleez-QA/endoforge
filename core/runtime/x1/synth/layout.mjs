const scalars = new Set(['number', 'integer', 'boolean', 'code']);
const limit = x => Number.isInteger(x) && x >= 1;
export const layoutOf = declared => (['record', 'list', 'text'].includes(declared?.kind) ? declared : null);
export function validLayout(declared) {
  if (!declared || typeof declared !== 'object') return false;
  const { kind } = declared;
  if (scalars.has(kind)) return true;
  if (kind === 'text') return limit(declared.maxBytes);
  if (kind === 'list') return limit(declared.max) && validLayout(declared.items);
  if (kind !== 'record' || !Array.isArray(declared.fields) || !declared.fields.length) return false;
  if (!declared.fields.every(field => field && typeof field === 'object' && typeof field.name === 'string')) return false;
  return new Set(declared.fields.map(field => field.name)).size === declared.fields.length && declared.fields.every(validLayout);
}
export function laidOut(value, declared) {
  const { kind } = declared;
  if (kind === 'integer' || kind === 'code') {
    if (!Number.isInteger(value) || value < -(2 ** 31) || value >= 2 ** 31) return undefined;
    const codes = declared.codes;
    return kind === 'code' && codes && typeof codes === 'object' && !Array.isArray(codes) && !Object.hasOwn(codes, String(value)) ? undefined : value;
  }
  if (kind === 'boolean') return typeof value === 'boolean' ? value : value === 0 || value === 1 ? Boolean(value) : undefined;
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (kind === 'text') return typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= declared.maxBytes ? value : undefined;
  if (kind === 'list') {
    if (!Array.isArray(value) || value.length > declared.max) return undefined;
    const items = value.map(item => laidOut(item, declared.items));
    return items.includes(undefined) ? undefined : items;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const names = declared.fields.map(field => field.name);
  if (Object.keys(value).length !== names.length || !names.every(name => Object.hasOwn(value, name))) return undefined;
  const entries = declared.fields.map(field => [field.name, laidOut(value[field.name], field)]);
  return entries.some(([, leaf]) => leaf === undefined) ? undefined : Object.fromEntries(entries);
}
export function shaped(result, declared) {
  if (!result) return result;
  if (declared && result.invalid) return { error: result.error, misfit: true };
  if (!('value' in result)) return result;
  if (!declared) return typeof result.value === 'number' ? result : { error: 'not a number' };
  const value = laidOut(result.value, declared);
  return value === undefined ? { error: 'does not fit the declared layout', misfit: true } : { value };
}
export function shapeOf(declared) {
  const { kind } = declared;
  if (kind === 'text') return { kind, maxBytes: declared.maxBytes };
  if (kind === 'list') return { kind, max: declared.max, items: shapeOf(declared.items) };
  if (kind === 'record') return { kind, fields: declared.fields.map(field => ({ name: field.name, shape: shapeOf(field) })) };
  if (kind === 'code' && declared.codes && typeof declared.codes === 'object') return { kind, codes: Object.keys(declared.codes).sort() };
  return { kind };
}
