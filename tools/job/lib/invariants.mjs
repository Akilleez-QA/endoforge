// The invariants for ANY task (Craig, 2026-10-26: "not just on this task but any task, what are the invariants").
// Every validator rule cites one; the job card shows which hold. The breaches behind each are in
// forge/endoforge/docs/PLAYBOOK-deadline-fanout.md. Kind plugins (lib/kinds.mjs) only add kind-specific checks.
export const INVARIANTS = [
  ['I1', 'Intent fidelity', 'the goal is the user\'s words plus the primary sources, never a summary; the brief is shown back before any spend'],
  ['I2', 'Reference primacy', 'every defining reference is named, says what it governs, sits on durable disk and reaches every atom it governs'],
  ['I3', 'Measurable acceptance', 'every criterion maps to a check that can fail, calibrated on known-good and known-bad cases; proxies are labelled'],
  ['I4', 'Truth before polish', 'ground truth and tolerances come before building'],
  ['I5', 'One writer', 'every file has exactly one owner at a time; seams have owners or contracts'],
  ['I6', 'Independent atoms', 'atoms are locally checkable; splits are proven no-op against a measured noise floor'],
  ['I7', 'Durability', 'briefs, references, state and notes on durable disk, never /tmp'],
  ['I8', 'Bounded execution', 'owner-bound, throttled, under the capacity dial; nothing outlives its owner; guards never bypassed'],
  ['I9', 'Smoke before scale', 'one atom per engine or path first, then ramp while measuring'],
  ['I10', 'Monotonic progress', 'a ratchet: no change raises HARD failures; a regression reverts per atom'],
  ['I11', 'Explicit authority', 'human gates listed, batched, off the critical path, reused by id; a relayed approval never counts'],
  ['I12', 'Honest state', 'delivered is not verified, a proxy is not the outcome; report only what ran'],
  ['I13', 'Constraint focus', 'name the binding constraint; duplicates only there; stream instead of barriers'],
  ['I14', 'Learning loop', 'every mistake logged with its cost; every lesson becomes a tool change or a tracked gap and reaches the next job'],
  ['I15', 'Contract capability', 'each criterion names the atoms that satisfy it, and their contracts can express what it requires '],
].map(([id, name, rule]) => ({ id, name, rule }));
export const INVARIANT = Object.fromEntries(INVARIANTS.map((i) => [i.id, i]));

// The intake is POODO executed as code (Craig: "this is /poodo"; ~/.claude/skills/poodo/SKILL.md is the method).
// Each stage is a gate; validating a gate runs every rule of that gate and the gates before it. The root cause it
// answers: Endoforge's loop started at launch, not at understanding.
export const GATES = [
  { id: 'pontificate', name: 'Pontificate', what: 'the verbatim goal, the primary sources and a decompressed brief', invariants: ['I1'] },
  { id: 'observe', name: 'Observe', what: 'the truth and reference package on durable disk', invariants: ['I2', 'I4', 'I7'] },
  { id: 'orient', name: 'Orient', what: 'atoms, seams, the critical path, the strongest rival, and contracts able to express the criteria', invariants: ['I5', 'I6', 'I13', 'I15'] },
  { id: 'decide', name: 'Decide', what: 'precommitted, calibrated checks, the smoke receipt, gates and the user\'s confirmation', invariants: ['I3', 'I9', 'I11'] },
  { id: 'orchestrate', name: 'Orchestrate', what: 'the bounded fan-out: throttle, dial, health', invariants: ['I8'] },
  { id: 'loop', name: 'Loop', what: 'the ratchet, claims bounded by receipts, lessons fed forward', invariants: ['I10', 'I12', 'I14'] },
];
export const gateIndex = (id) => GATES.findIndex((g) => g.id === id);
