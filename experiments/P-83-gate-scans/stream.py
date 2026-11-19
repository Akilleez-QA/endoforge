import hashlib
import json
import re
import sys

# Compare two width-1 capture rows' ledger requests need by need (P-80's correctness guard, reused by P-81 to P-83).
# admit and park: byte-identical after replacing the row's temporary directory. commit: identical after dropping
# timing and process fields (wall times, cell pids, resource limits) that differ between any two runs.
# P-83's lever changes contract.mjs, which is one of the 14 implementation files frozen into every record, so its digest
# (and the frozen identity and digest derived from the record) differ by construction; they are mapped to placeholders.
VOLATILE = {"timings", "workcell", "resourceLimits", "wasmMemoryMaxMb", "ms", "rerun", "evaluator_digest", "oracle_version"}
CHANGED = {"76603d98737c42a011cb245ba56fe1aa1c5f957e7fa306363b71d4876fb2c65c", "ef52e96fc5b6f7da83aa950d98055efeebac67b698b15fbd00a882ef5f025f28"}
FROZEN = re.compile(r"evr:[0-9a-f]{64}")


def load(path):
    needs = {}
    for line in open(path):
        request = json.loads(line)
        ledger = request["job"]["reference"]["ledger"]
        need = ledger.split("/")[-2]
        request.pop("id")
        text = json.dumps(request).replace(ledger.rsplit("/", 2)[0], "ROW")
        for digest in CHANGED:
            text = text.replace(digest, "CONTRACT_MJS")
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
