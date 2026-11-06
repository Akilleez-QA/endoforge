import os
import signal
import sqlite3

point = os.environ.get("EF_BRIDGE_KILL")
if point:
    import core.ledger.ledger as ledger_module
    import core.ledger.x1_loop as loop

    state = dict(active=False, appended=0)

    def kill():
        os.kill(os.getpid(), signal.SIGKILL)

    original_commit, original_append, original_write = loop.commit, ledger_module.Ledger._append, loop.write_decision

    def commit(request, prior, append, process):
        state["active"] = True
        if point == "commit_start":
            kill()
        return original_commit(request, prior, append, process)

    def counted_append(self, db, record, prior, previous):
        result = original_append(self, db, record, prior, previous)
        if state["active"]:
            state["appended"] += 1
            if (point, state["appended"]) in {("after_register", 1), ("after_receipt", 2)}:
                kill()
        return result

    class Connection(sqlite3.Connection):
        def commit(self):
            if state["active"] and point == "before_commit":
                kill()
            super().commit()

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5, factory=Connection)
        db.execute("PRAGMA synchronous=FULL")
        return db

    def write_decision(result):
        written = isinstance(result, dict) and "decisionPath" in result
        if written and point == "after_commit":
            kill()
        original_write(result)
        if written and point == "after_decision":
            kill()

    loop.commit = commit
    loop.LOOP["commit"] = commit
    loop.write_decision = write_decision
    ledger_module.Ledger._append = counted_append
    ledger_module.Ledger._connect = connect
