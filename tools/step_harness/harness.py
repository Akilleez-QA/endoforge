"""Endoforge step harness: a bounded agent step loop in which every step is POODO evidence.

Pure policy and orchestration, stdlib only. Nothing here calls a provider: the model, the
POODO core, the ledger, the clock and any summariser are injected. Parts re-implemented from
the wall (staging target endoforge.harness): oss-opencode-agent-step-loop (outcome classes,
compaction only between steps), oss-opencode-context-compaction (threshold trigger, structured
checkpoint updated in place), oss-hermes-iteration-budget, oss-hermes-repetition-loop-guard
(applied to tool calls, never replaying the looped call), oss-hermes-goal-judge-loop (DONE,
BLOCKED, CONTINUE; a model verdict is an observation, never acceptance) and
oss-pstack-orchestrate-single-writer-store (one writer, status derived from records).

Ports, as duck-typed callables or objects:
  model(view: dict) -> dict   one of
      {"kind": "tool_call", "plan": str, "capability_id": str, "operation": str,
       "arguments": dict, "precommitment": {"expected_observation", "success_boundary",
       "failure_meaning"}}
      {"kind": "claim_done", "text": str}      an observation; never closes the goal
      {"kind": "blocked", "reason": str}       a refusal; stops with BLOCKED
  core.decide(proposal: dict) -> {"status": "decided", "decision_id": str}
                               | {"status": "refused", "reason": str, "blocking": bool}
  core.execute(decision_id) -> outcome dict carrying execution_status, execution_certainty
                               and raw_result (the CapabilityOutcome fields)
  ledger.append(kind: str, data: dict) -> dict   (LedgerPort.append)
  clock() -> float seconds, monotonic

A real-core adapter maps decide/execute onto PoodoCore.decide/execute with the phase checkpoints
it requires; that adapter is not part of this module.
"""
from dataclasses import dataclass, field
import json

CONTINUE, DONE, BLOCKED = "CONTINUE", "DONE", "BLOCKED"
STOP_BUDGET, STOP_CLOCK, STOP_REPEAT = "STOPPED_BUDGET", "STOPPED_CLOCK", "STOPPED_REPETITION"
STOP_UNCERTAIN, STOP_MODEL = "HALTED_UNCERTAIN_OUTCOME", "STOPPED_MODEL_ERROR"
PRECOMMIT_FIELDS = ("expected_observation", "success_boundary", "failure_meaning")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def estimate_tokens(value):
    """Heuristic (about four characters per token); never a provider measurement."""
    return (len(canonical(value)) + 3) // 4


@dataclass(frozen=True)
class Criterion:
    """One acceptance criterion and the host-owned evidence that satisfies it.

    Evidence is a completed, responded outcome from capability_id/operation whose raw_result
    passes `accepts` (default: any). The model cannot supply or widen this predicate.
    """
    criterion_id: str
    text: str
    capability_id: str
    operation: str
    accepts: object = None

    def matches(self, call, outcome):
        if (call["capability_id"], call["operation"]) != (self.capability_id, self.operation):
            return False
        if outcome.get("execution_status") != "completed" or outcome.get("execution_certainty") != "responded":
            return False
        return self.accepts is None or bool(self.accepts(outcome.get("raw_result")))


@dataclass(frozen=True)
class Limits:
    max_steps: int = 20
    max_seconds: float = 600.0
    repeat_limit: int = 3
    compact_threshold_tokens: int = 8000
    keep_recent_steps: int = 2

    def __post_init__(self):
        if self.max_steps < 1 or self.max_seconds <= 0 or self.repeat_limit < 2 or self.keep_recent_steps < 0:
            raise ValueError("Harness limits must be positive, and repetition needs at least two calls")


@dataclass
class Result:
    verdict: str
    reason: str
    steps: int
    evidence: dict = field(default_factory=dict)
    checkpoint: dict | None = None


class StepHarness:
    def __init__(self, *, goal, criteria, model, core, ledger, clock, limits=None, summarise=None):
        if not criteria:
            raise ValueError("A completion contract needs at least one acceptance criterion")
        self.goal, self.criteria, self.model = dict(goal), tuple(criteria), model
        self.core, self.ledger, self.clock = core, ledger, clock
        self.limits, self.summarise = limits or Limits(), summarise
        self.steps, self.checkpoint, self.evidence = [], None, {}
        self._calls, self._running, self._done = {}, False, False

    def _record(self, kind, data, refs=None):
        event = self.ledger.append("harness." + kind, data)
        ref = {"kind": "harness." + kind, "sequence": event.get("sequence"),
               "event_sha256": event.get("event_sha256")}
        if refs is not None:
            refs.append(ref)
        return ref

    def _view(self, started):
        return {"goal": self.goal, "criteria": [{"id": c.criterion_id, "text": c.text} for c in self.criteria],
                "checkpoint": self.checkpoint, "recent_steps": self.steps,
                "remaining": {"steps": self.limits.max_steps - self._used,
                              "seconds": self.limits.max_seconds - (self.clock() - started)}}

    def _finish(self, verdict, reason, step_no):
        self._record("verdict", {"step": step_no, "verdict": verdict, "reason": reason,
                                 "evidence": self.evidence, "goal_closed": False,
                                 "runtime_goal_acceptance": False})
        return Result(verdict, reason, self._used, dict(self.evidence), self.checkpoint)

    def run(self):
        if self._running or self._done:
            raise RuntimeError("A harness run is single-writer and single-use")
        self._running, self._used, started = True, 0, self.clock()
        try:
            return self._loop(started)
        finally:
            self._running, self._done = False, True

    def _loop(self, started):
        lim = self.limits
        while True:
            if self._used >= lim.max_steps:
                return self._finish(STOP_BUDGET, f"iteration budget of {lim.max_steps} spent", self._used)
            if self.clock() - started >= lim.max_seconds:
                return self._finish(STOP_CLOCK, f"wall-clock budget of {lim.max_seconds}s spent", self._used)
            self._maybe_compact()
            self._used += 1
            step_no, refs = self._used, []
            step = {"step": step_no, "ledger_refs": refs}
            try:
                proposal = self.model(self._view(started))
            except Exception as exc:  # A provider failure is recorded, not retried here.
                self._record("model_error", {"step": step_no, "error": type(exc).__name__}, refs)
                return self._finish(STOP_MODEL, "model call raised " + type(exc).__name__, step_no)
            verdict = self._step(step, proposal, refs)
            self.steps.append(step)
            if verdict is not None:
                return self._finish(*verdict, step_no)

    def _step(self, step, proposal, refs):
        kind = proposal.get("kind") if isinstance(proposal, dict) else None
        step_no = step["step"]
        if kind == "blocked":
            reason = str(proposal.get("reason", ""))[:2000]
            self._record("proposal", {"step": step_no, "kind": "blocked", "reason": reason}, refs)
            step.update(kind="blocked", reason=reason)
            return BLOCKED, "model reported blocked: " + reason
        if kind == "claim_done":
            text = str(proposal.get("text", ""))[:2000]
            self._record("proposal", {"step": step_no, "kind": "claim_done", "text": text}, refs)
            judged = self._judge()
            self._record("judgement", {"step": step_no, "claim": "done", "judged": judged[0],
                                       "missing": self._missing()}, refs)
            step.update(kind="claim_done", judged=judged[0])
            return judged if judged[0] == DONE else None
        call = self._parse_call(proposal)
        if call is None:
            self._record("proposal", {"step": step_no, "kind": "malformed",
                                      "received": str(kind)[:200]}, refs)
            step.update(kind="malformed")
            return None
        key = canonical([call["capability_id"], call["operation"], call["arguments"]])
        seen = self._calls.get(key, 0) + 1
        self._calls[key] = seen
        if seen >= self.limits.repeat_limit:
            # Record the fact of repetition, never re-dispatch the looped call.
            self._record("proposal", {"step": step_no, "kind": "repeated_call", "repeat_count": seen,
                                      "capability_id": call["capability_id"],
                                      "operation": call["operation"]}, refs)
            step.update(kind="repeated_call", call=call)
            return STOP_REPEAT, f"identical tool call proposed {seen} times"
        self._record("proposal", {"step": step_no, "kind": "tool_call", **call}, refs)
        step.update(kind="tool_call", call={k: call[k] for k in ("capability_id", "operation", "arguments")})
        decision = self.core.decide(call)
        status = decision.get("status")
        self._record("decision", {"step": step_no, **decision}, refs)
        if status != "decided":
            step.update(decision="refused", reason=decision.get("reason"))
            if decision.get("blocking"):
                return BLOCKED, "core refused with a blocking reason: " + str(decision.get("reason"))
            return None
        step["decision"] = decision["decision_id"]
        try:
            outcome = self.core.execute(decision["decision_id"])
        except Exception as exc:
            outcome = {"execution_status": "indeterminate", "execution_certainty": "unknown",
                       "raw_result": None, "harness_note": "execute raised " + type(exc).__name__}
        out_ref = self._record("outcome", {"step": step_no, "decision_id": decision["decision_id"],
                                           "outcome": outcome}, refs)
        step["outcome"] = {"execution_status": outcome.get("execution_status"),
                           "execution_certainty": outcome.get("execution_certainty")}
        if outcome.get("execution_certainty") == "unknown" or outcome.get("execution_status") == "indeterminate":
            # POODO: execution may have occurred. No automatic retry; the host reconciles.
            return STOP_UNCERTAIN, "outcome of " + decision["decision_id"] + " is unknown; not retried"
        for c in self.criteria:
            if c.criterion_id not in self.evidence and c.matches(step["call"], outcome):
                self.evidence[c.criterion_id] = {"decision_id": decision["decision_id"], "ledger_ref": out_ref}
        judged = self._judge()
        self._record("judgement", {"step": step_no, "judged": judged[0], "missing": self._missing()}, refs)
        return judged if judged[0] == DONE else None

    @staticmethod
    def _parse_call(p):
        if not isinstance(p, dict) or p.get("kind") != "tool_call":
            return None
        pre = p.get("precommitment")
        if (not all(isinstance(p.get(k), str) and p.get(k) for k in ("capability_id", "operation"))
                or not isinstance(p.get("arguments"), dict) or not isinstance(pre, dict)
                or not all(isinstance(pre.get(k), str) and pre.get(k) for k in PRECOMMIT_FIELDS)):
            return None
        return {"plan": str(p.get("plan", ""))[:2000], "capability_id": p["capability_id"],
                "operation": p["operation"], "arguments": p["arguments"],
                "precommitment": {k: pre[k] for k in PRECOMMIT_FIELDS}}

    def _missing(self):
        return [c.criterion_id for c in self.criteria if c.criterion_id not in self.evidence]

    def _judge(self):
        """Completion contract: DONE only when every criterion has a matching evidence event."""
        missing = self._missing()
        return (DONE, "every acceptance criterion has matching evidence") if not missing else (
            CONTINUE, "missing evidence for " + ", ".join(missing))

    def _maybe_compact(self):
        lim = self.limits
        if len(self.steps) <= lim.keep_recent_steps:
            return
        if estimate_tokens({"checkpoint": self.checkpoint, "steps": self.steps}) <= lim.compact_threshold_tokens:
            return
        cut = len(self.steps) - lim.keep_recent_steps
        old, self.steps = self.steps[:cut], self.steps[cut:]
        prior = self.checkpoint or {"decisions": [], "ledger_refs": [], "folded_steps": 0, "notes": []}
        decisions = prior["decisions"] + [
            {"step": s["step"], "kind": s.get("kind"), "decision": s.get("decision"),
             "call": [s["call"]["capability_id"], s["call"]["operation"]] if "call" in s else None,
             "outcome": s.get("outcome")} for s in old]
        refs = prior["ledger_refs"] + [r for s in old for r in s["ledger_refs"]]
        open_questions = [f"{c.criterion_id}: {c.text}" for c in self.criteria if c.criterion_id not in self.evidence]
        open_questions += [q for q in prior.get("open_questions", []) if q.startswith("step ")]
        open_questions += [f"step {s['step']}: refused: {s.get('reason')}" for s in old if s.get("decision") == "refused"]
        notes = list(prior["notes"])[-7:]
        if self.summarise is not None:  # Optional prose; never replaces the structured fields.
            notes.append(str(self.summarise(old))[:2000])
        self.checkpoint = {"goal": self.goal, "decisions": decisions, "evidence": dict(self.evidence),
                           "open_questions": open_questions, "notes": notes, "ledger_refs": refs,
                           "folded_steps": prior["folded_steps"] + len(old)}
        self._record("checkpoint", self.checkpoint)
