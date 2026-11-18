import hashlib
import json
import re
import sys

# Compare two width-1 capture rows' ledger requests need by need (P-80's correctness guard, reused by P-81).
# admit and park: byte-identical after replacing the row's temporary directory. commit: identical after dropping
# timing and process fields (wall times, cell pids, resource limits) that differ between any two runs.
# The lever changes loop-port.mjs, which is one of the 14 implementation files frozen into every record, so its digest
# (and the frozen identity and digest derived from the record) differ by construction; they are mapped to placeholders.
VOLATILE = {"timings", "workcell", "resourceLimits", "wasmMemoryMaxMb", "ms", "rerun", "evaluator_digest", "oracle_version"}
LOOP_PORT = {"1f06c0a08a2b76355e52c4b87fc2578b37d8851a4289483ab189bcac3ee3d79f", "421c25d894ebfe4abd2c57fc68a0d4d7dd1d240b0de01c8da39eb1cf75d08ad5"}
FROZEN = re.compile(r"evr:[0-9a-f]{64}")


def load(path):
    needs = {}
    for line in open(path):
        request = json.loads(line)
        ledger = request["job"]["reference"]["ledger"]
        need = ledger.split("/")[-2]
        request.pop("id")
        text = json.dumps(request).replace(ledger.rsplit("/", 2)[0], "ROW")
        for digest in LOOP_PORT:
            text = text.replace(digest, "LOOP_PORT")
        text = FROZEN.sub("evr:FROZEN", text)
        needs.setdefault(need, []).append((request["action"], text))
    return needs


def scrub(value):
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k not in VOLATILE}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        value = re.sub(r'\\?"(wallMs|maxMs|ms)\\?":[0-9.e-]+', r"\1", value)
        return re.sub(r'\\?"at\\?":\\?"[0-9T:.Z-]+\\?"', "at", value)
    return value


def comparable(action, text):
    if action != "commit":
        return text
    request = json.loads(text)
    return json.dumps(scrub(request), sort_keys=True)


a, b = load(sys.argv[1]), load(sys.argv[2])
common = sorted(set(a) & set(b), key=lambda n: int(n.rsplit("-", 1)[1]))
complete = [n for n in common if [x for x, _ in a[n]] and a[n][-1][0] == "commit" and b[n][-1][0] == "commit"]
same = {"admit": 0, "park": 0, "commit": 0}
differ = []
for need in complete:
    if [x for x, _ in a[need]] != [x for x, _ in b[need]]:
        differ.append((need, "actions", [x for x, _ in a[need]], [x for x, _ in b[need]]))
        continue
    for (action, left), (_, right) in zip(a[need], b[need]):
        if comparable(action, left) == comparable(action, right):
            same[action] += 1
        else:
            differ.append((need, action))
digest = hashlib.sha256("".join(comparable(x, t) for n in complete for x, t in a[n]).encode()).hexdigest()
print(json.dumps({"needs_compared": len(complete), "identical": same, "differ": differ[:10], "differ_count": len(differ), "stream_sha256": digest}))
