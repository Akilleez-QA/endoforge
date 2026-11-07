import random
import re
from collections import Counter

from ..seeded_faults.generator import clone, generate
from .stats import bounds


MAX_SUBMISSIONS = 100_000


def seeded(known_good, *, domain, task, **arguments):
    batch = generate(known_good, **arguments)
    provenance = {key: value for key, value in batch.items() if key not in ("faults", "filtered", "strata")}
    return [row | dict(domain=domain, task=task, generator=provenance) for row in batch["faults"]]


def summarize(rows):
    faults = [row for row in rows if row["faulty"]]
    escapes = sum(row["promoted"] for row in faults)
    return dict(n=len(faults), escapes=escapes, submitted=len(rows),
                promotions=sum(row["promoted"] for row in rows), **bounds(escapes, len(faults)),
                caught_by=dict(Counter(row["first_failure"] for row in faults if row["first_failure"])))


def run(candidates, evaluate, current_digest, *, frozen_digest, checks, lane,
        candidate_format, seed, propose=None, oracle=None, width=1, rounds=0):
    checks, candidates = clone(checks), clone(candidates)
    search = propose is not None
    if (not re.fullmatch(r"[0-9a-f]{64}", frozen_digest) or lane not in ("interim", "kernel")
            or type(candidate_format) is not str or not candidate_format
            or type(seed) is not int or type(width) is not int or width not in (1, 4, 16)
            or type(rounds) is not int or rounds < 0 or type(candidates) is not list or not candidates
            or len(candidates) + width * rounds > MAX_SUBMISSIONS
            or not isinstance(checks, list) or not checks
            or any(type(check) is not str or not check for check in checks)
            or len(set(checks)) != len(checks)
            or (search and (not callable(oracle) or rounds == 0))
            or (not search and (rounds != 0 or width != 1 or oracle is not None))):
        raise ValueError("invalid campaign configuration or submission budget")
    receipts, seen = [], set()

    def guard():
        if current_digest() != frozen_digest:
            raise ValueError("frozen evaluator digest changed")

    def submit(candidate, generation):
        guard()
        if (type(candidate) is not dict
                or any(type(candidate.get(key)) is not str or not candidate[key]
                       for key in ("id", "domain", "task", "stratum"))
                or candidate["stratum"] not in ("S1", "S2", "S3", "S4")
                or candidate["id"] in seen):
            raise ValueError("invalid or duplicate candidate")
        seen.add(candidate["id"])
        faulty = True if generation == 0 else oracle(clone(candidate))
        guard()
        if type(faulty) is not bool:
            raise ValueError("independent oracle must label each searched candidate")
        verdict = clone(evaluate(clone(candidate)))
        guard()
        results = verdict.get("results", [])
        if (not results or type(results) is not list or len(results) > len(checks)
                or any(type(row) is not dict or row.get("check") != checks[index]
                       or type(row.get("passed")) is not bool for index, row in enumerate(results))
                or type(verdict.get("promoted")) is not bool):
            raise ValueError("ordered check evidence and explicit promotion required")
        failed = next((row["check"] for row in results if not row["passed"]), None)
        if ((verdict["promoted"] and failed) or (failed is None and len(results) != len(checks))):
            raise ValueError("promotion without complete passing checks")
        receipts.append(dict(candidate=candidate, faulty=faulty, promoted=verdict["promoted"],
                             results=results, first_failure=failed, generation=generation,
                             stratum=candidate["stratum"] if generation == 0 else "S4",
                             frozen_digest=frozen_digest, lane=lane, candidate_format=candidate_format,
                             mode="searched" if search else "sampled", width=width))

    guard()
    random.Random(seed).shuffle(candidates)
    for candidate in candidates:
        submit(candidate, 0)
    for generation in range(1, rounds + 1):
        feedback = [dict(candidate=row["candidate"], results=row["results"], promoted=row["promoted"])
                    for row in receipts]
        guard()
        batch = clone(propose(generation, width, clone(feedback)))
        guard()
        if type(batch) is not list or len(batch) != width:
            raise ValueError("search must propose exactly width candidates per round")
        for candidate in batch:
            submit(candidate, generation)
    guard()
    domains = sorted({row["candidate"]["domain"] for row in receipts})
    reports = {}
    for domain in domains:
        rows = [row for row in receipts if row["candidate"]["domain"] == domain]
        reports[domain] = summarize(rows) | dict(strata={
            stratum: summarize([row for row in rows if row["stratum"] == stratum])
            for stratum in sorted({row["stratum"] for row in rows})})
    return dict(seed=seed, rounds=rounds, receipts=receipts, domains=reports,
                statistical_scope="binomial diagnostic; independence not established")
