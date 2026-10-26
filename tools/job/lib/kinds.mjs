// Job-kind plugins. The generic validator (lib/validate.mjs) enforces the invariants for any task; a kind adds only
// what is specific to it, as extra rules for a POODO gate, each citing its invariant. New kinds go here.
const kindOf = (x, k) => x.criteria.filter((c) => c.check?.kind === k);

/** A reference that governs how something looks needs a likeness check against it (the a collaborator miss, NOTES #21). */
function likenessForLooks(job, x, aspects) {
  const out = [];
  for (const r of x.refs) {
    if (!(r.governs ?? []).some((g) => aspects.includes(g))) continue;
    if (!kindOf(x, 'likeness').some((c) => c.check.reference === r.id)) out.push(['I3', `reference ${r.id} governs ${r.governs.join(', ')}: add a likeness check against it`]);
  }
  return out;
}

export const KINDS = {
  generic: { checks: {} },
  doc: { checks: {} },
  video: {
    checks: {
      decide: (job, x) => [
        ...likenessForLooks(job, x, ['model', 'character', 'look', 'set']),
        ...(kindOf(x, 'eval').length ? [] : [['I3', 'a video needs a numeric eval gate over its stills (framing, visibility, timing)']]),
      ],
    },
  },
  model3d: {
    checks: {
      decide: (job, x) => [
        ...likenessForLooks(job, x, ['model', 'character', 'look', 'geometry']),
        ...(kindOf(x, 'likeness').length || kindOf(x, 'eval').length ? [] : [['I3', 'a 3D model needs a likeness or dimension check']]),
      ],
    },
  },
  code: {
    splitByTests: true,                       // a refactor's split is proven by the tests before and after
    checks: {
      decide: (job, x) => (kindOf(x, 'tests').length ? [] : [['I3', 'a code job needs a tests criterion (the suite that must pass before and after)']]),
    },
  },
  campus: {
    requiresTruth: true,                      // the campus model was 4 m off the LiDAR (I4)
    checks: {
      observe: (job) => (job.truth ?? []).some((t) => /survey|lidar|photo|drawing|measure/i.test(`${t.id} ${t.what}`)) ? []
        : [['I4', 'the truth package must include survey evidence (LiDAR, photos, drawings or measurements)']],
      decide: (job, x) => (kindOf(x, 'site-rules').some((c) => c.check.baseline) ? [] : [['I3', 'a campus job needs a site-rules check with its ratchet baseline']]),
    },
  },
};
