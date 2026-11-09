const within = (inner, outer) => inner === outer || Boolean(inner?.startsWith(`${outer}/`));
const owns = (entry, who) => {
  const scope = entry.scope ?? {};
  if (scope.tenant && scope.tenant !== who.tenant) return 'foreign';
  if (scope.lineage && !within(who.lineage, scope.lineage)) return 'denied';
  return 'allow';
};
export function access(entry, principal, grants) {
  const who = principal ?? {};
  if ((grants.get(entry.id) ?? []).some(grant => grant.tenant === who.tenant && (!grant.lineage || within(who.lineage, grant.lineage)))) return 'allow';
  return owns(entry, who);
}
export function mayGrant(entry, by) {
  if (owns(entry, by ?? {}) !== 'allow') throw Error(`permission denied: cannot change grants on ${entry.id}`);
}
