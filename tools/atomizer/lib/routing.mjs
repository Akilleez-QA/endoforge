import fs from 'node:fs';

export function assertModelAllowed(model, tier) {
  if (/luna/i.test(model) && tier !== 'throwaway') throw new Error(`luna model forbidden for tier ${tier}`);
}
export function loadRouting(file = new URL('../routing.json', import.meta.url)) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!r.tiers || typeof r.tiers !== 'object' || Array.isArray(r.tiers)) throw new Error('missing tiers');
  for (const [tier, spec] of Object.entries(r.tiers)) {
    for (const s of [spec, ...(spec?.fallback ? [spec.fallback] : [])]) {
      if (typeof s?.model !== 'string' || !s.model.trim()) throw new Error(`invalid model for tier ${tier}`);
      if (!['low', 'medium', 'high', 'xhigh'].includes(s.effort)) throw new Error(`invalid effort for tier ${tier}`);
      assertModelAllowed(s.model, tier);
    }
  }
  if (!Array.isArray(r.escalation) || !r.escalation.length) throw new Error('invalid escalation');
  if (!r.kindTier || typeof r.kindTier !== 'object' || Array.isArray(r.kindTier)) throw new Error('invalid kindTier');
  for (const tier of [r.default, ...r.escalation, ...Object.values(r.kindTier)]) {
    if (!Object.hasOwn(r.tiers, tier) || tier === 'throwaway') throw new Error(`invalid automatic tier ${tier}`);
  }
  return r;
}
export function classify(atom, routing) {
  const override = atom.worker?.tier ?? atom.tier;
  if (override !== undefined) {
    if (!Object.hasOwn(routing.tiers, override)) throw new Error(`unknown tier ${override}`);
    return { tier: override, reason: 'override' };
  }
  const automatic = (tier, reason) => {
    if (tier === 'throwaway') throw new Error('throwaway requires an override');
    return { tier, reason };
  };
  if (Object.hasOwn(routing.kindTier, atom.kind)) return automatic(routing.kindTier[atom.kind], `kind:${atom.kind}`);
  const prompt = atom.prompt ?? '';
  const text = [prompt, atom.title, atom.description].filter(Boolean).join(' ').toLowerCase();
  for (const tier of ['deep', 'light']) {
    const word = routing.keywords[tier].find((w) => text.includes(w.toLowerCase()));
    if (word) return automatic(tier, `keyword:${word}`);
  }
  const files = (atom.consumes || []).length + (atom.produces || []).length;
  if (files > routing.deepIfFilesOver) return automatic('deep', `files:${files}`);
  if (prompt.length > routing.deepIfPromptCharsOver) return automatic('deep', `size:${prompt.length}`);
  return automatic(routing.default, 'default');
}
export function escalate(tier, attempt, routing) {
  const i = routing.escalation.indexOf(tier);
  return i < 0 ? tier : routing.escalation[Math.min(i + Math.max(0, attempt - 1), routing.escalation.length - 1)];
}
export function resolve(atom, attempt, routing, { fallback = false } = {}) {
  const { tier: baseTier, reason } = classify(atom, routing);
  const tier = escalate(baseTier, attempt, routing), spec = routing.tiers[tier];
  if (tier === 'throwaway' && reason !== 'override') throw new Error('throwaway requires an override');
  const { model, effort } = fallback && spec.fallback ? spec.fallback : spec;
  assertModelAllowed(model, tier);
  return { tier, baseTier, reason, model, effort, scratch: !!spec.scratch };
}
export function codexArgs(sel) {
  return ['-m', sel.model, '-c', `model_reasoning_effort=${sel.effort}`];
}
