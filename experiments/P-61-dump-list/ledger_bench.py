import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.ledger.ledger import Ledger
from tools.ledger_writer import Journal, Writer


def task(request, prior, append, _process, _db):
    append(dict(version=0, kind="task", id="task", data=dict(intent=request["result"]["need"], acceptance="bench")))
    return dict(seq=len(prior))


def note(request, prior, append, _process, _db):
    append(dict(version=0, kind="admitted_input", id=request["result"]["id"],
                data=dict(task="task", content=request["result"]["id"], origin="caller")))
    return dict(seq=len(prior))


EXTENSION = types.SimpleNamespace(LOOP=dict(admit=task, note=note))


def rss():
    with open("/proc/self/statm") as handle:
        return int(handle.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")


def line(identity, action, ledger, **result):
    return json.dumps(dict(id=identity, action=action, job=dict(reference=dict(ledger=str(ledger))), result=result)).encode()


def trial(number, ledgers, notes):
    root = Path(tempfile.mkdtemp(prefix="p61-ledger-"))
    try:
        writer = Writer(None, EXTENSION, Journal(root / "journal"), io.StringIO())
        paths = [root / f"l{index}" / "ledger.sqlite" for index in range(ledgers)]
        for start in range(0, ledgers, 128):
            writer.batch([line(index, "admit", paths[index], need=f"need {index}") for index in range(start, min(ledgers, start + 128))])
        for round_ in range(notes):
            for start in range(0, ledgers, 128):
                writer.batch([line(10**6 * (round_ + 1) + index, "note", paths[index], id=f"n{round_}") for index in range(start, min(ledgers, start + 128))])
        handles = len(writer.handles)
        reported = writer.sheddable()
        before = sorted(rss() for _ in range(20))[10]
        started = time.perf_counter()
        writer.shed()
        shed_ms = (time.perf_counter() - started) * 1000
        after = sorted(rss() for _ in range(20))[10]
        answers = len(writer.output.getvalue().splitlines())
        writer.batch([line(9 * 10**8 + index, "note", paths[index], id="after") for index in range(min(ledgers, 64))])
        writer.close()
        intact = all(len(Ledger(str(path)).records()) == 1 + notes + (1 if index < 64 else 0) for index, path in enumerate(paths))
        return dict(trial=number, ledgers=ledgers, handles=handles, reported_mib=round(reported / 2**20, 2), freed_mib=round((before - after) / 2**20, 2),
                    freed_ratio=round((before - after) / reported, 3) if reported else None, shed_ms=round(shed_ms, 1),
                    bytes_per_handle=round(reported / handles) if handles else None, answers=answers, records_intact=intact,
                    load=float(open("/proc/loadavg").read().split()[0]))
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main():
    options = dict(item.split("=", 1) for item in sys.argv[1:] if "=" in item)
    trials, ledgers, notes = int(options.get("trials", 5)), int(options.get("ledgers", 1024)), int(options.get("notes", 2))
    for number in range(1, trials + 1):
        print(json.dumps(trial(number, ledgers, notes)), flush=True)


if __name__ == "__main__":
    main()
