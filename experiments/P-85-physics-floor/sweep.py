import json
import os
import subprocess
import sys
import time
from pathlib import Path

here = Path(__file__).resolve().parent
repo, base, corpus, out = (Path(a).resolve() for a in sys.argv[1:5])
out.mkdir(parents=True, exist_ok=True)
for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY"):
    os.environ.pop(name, None)
LOAD = "0.51,0.17,0.17,0.17,0.17"
WINDOW, WARM = "40", "12"


def load():
    return os.getloadavg()[0]


def swap_mb():
    text = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True).stdout.split()
    return float(text[text.index("used") + 2].rstrip("M"))


def caps():
    level = int(subprocess.run(["sysctl", "-n", "kern.memorystatus_level"], capture_output=True, text=True).stdout)
    free = os.statvfs(str(out)).f_bavail * os.statvfs(str(out)).f_frsize / 2**30
    if swap_mb() > 7000 or free < 20 or level < 15:
        raise SystemExit(f"stop: swap {swap_mb()} MB, free {free:.1f} GB, memory level {level}")


def quiet():
    for _ in range(80):
        if load() <= 4:
            break
        time.sleep(15)
    return load()


def probe(label, n, extra=()):
    args = ["node", str(here / "capacity.mjs"), str(repo), str(corpus), str(n), WINDOW, WARM, *extra]
    p = subprocess.run(args, capture_output=True, text=True, check=True)
    return json.loads(p.stdout.strip().splitlines()[-1])


def harness(label, width, rep):
    scratch = out / "scratch"
    scratch.mkdir(exist_ok=True)
    p = subprocess.run(["node", "experiments/P-84-bundle-objects/run.mjs", str(scratch), "p85-ref", "row", width, str(rep)],
                       cwd=base, capture_output=True, text=True)
    subprocess.run(["rm", "-rf", str(scratch)])
    line = next((x for x in p.stdout.splitlines() if x.startswith('{"label')), None)
    if p.returncode or line is None:
        raise SystemExit(f"{label} failed: {p.stdout[-800:]} {p.stderr[-800:]}")
    return json.loads(line)


def row(label, run):
    path = out / f"{label}.json"
    if path.exists():
        return
    caps()
    start = quiet()
    result = run()
    end = load()
    record = dict(label=label, loadStart=round(start, 2), loadEnd=round(end, 2), swapMb=swap_mb(), result=result)
    if end > 16:
        start = quiet()
        record = dict(label=label, loadStart=round(start, 2), loadedFirst=record, result=run(), loadEnd=round(load(), 2), swapMb=swap_mb())
    path.write_text(json.dumps(record, indent=1))
    print(json.dumps(record)[:400], flush=True)


plan = sys.argv[5]
counts = [1, 2, 4, 6, 8, 10, 12]
if plan == "pass1":
    for n in counts:
        row(f"p1-n{n}", lambda n=n: probe("", n))
    row("p1-n12-load", lambda: probe("", 12, (LOAD,)))
    row("p1-ref-w64", lambda: harness("p1-ref-w64", "w64", 4))
    row("p1-ref-w1", lambda: harness("p1-ref-w1", "w1", 4))
    row("p1-bg-n1", lambda: probe("", 1, ("", "background")))
    row("p1-bg-n6", lambda: probe("", 6, ("", "background")))
    row("p1-util-n1", lambda: probe("", 1, ("", "utility")))
elif plan == "pass2":
    row("p2-ref-w1", lambda: harness("p2-ref-w1", "w1", 5))
    row("p2-ref-w64", lambda: harness("p2-ref-w64", "w64", 5))
    row("p2-n12-load", lambda: probe("", 12, (LOAD,)))
    for n in reversed(counts):
        row(f"p2-n{n}", lambda n=n: probe("", n))
elif plan == "n14":
    if swap_mb() < 6000:
        row("p3-n14", lambda: probe("", 14))
print("DONE", plan)
