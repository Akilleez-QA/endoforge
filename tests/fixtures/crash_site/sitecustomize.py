import os
import signal
import sqlite3

point = os.environ.get("EF_BRIDGE_KILL")
if point:
    import core.ledger.ledger as ledger_module
    import tools.x1_loop as loop

    state = dict(active=False, appended=0)

    def kill():
        os.kill(os.getpid(), signal.SIGKILL)

    original_commit, original_append, original_write, original_admit = loop.commit, ledger_module.Ledger._append, loop.write_decision, loop.admit

    def admit(request, prior, append, process, db):
        if point == "admit_start":
            kill()
        state["admitting"] = True
        result = original_admit(request, prior, append, process, db)
        return result

    def commit(request, prior, append, process, db):
        state["active"] = True
        if point == "commit_start":
            kill()
        return original_commit(request, prior, append, process, db)

    def counted_append(self, db, record, prior, previous):
        result = original_append(self, db, record, prior, previous)
        if state["active"]:
            state["appended"] += 1
            if (point, state["appended"]) in {("after_register", 1), ("after_receipt", 2)}:
                kill()
        return result

    class Connection(sqlite3.Connection):
        def commit(self):
            if (state["active"] and point == "before_commit") or (state.get("admitting") and point == "admit_before_commit"):
                kill()
            super().commit()
            if state["active"] and point == "after_db_commit":
                kill()

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
    loop.LOOP["admit"] = admit
    loop.write_decision = write_decision
    ledger_module.Ledger._append = counted_append
    ledger_module.Ledger._connect = connect

writer_point = os.environ.get("EF_WRITER_KILL")
if writer_point:
    import core.ledger.writer as writer_module

    target, _, number = writer_point.partition(":")
    batches = dict(seen=0)
    armed = lambda: batches["seen"] >= int(number or 1)
    original_batch, original_write = writer_module.Writer.batch, writer_module.Journal.write
    original_append, original_sync, original_respond = writer_module.Journal.append, writer_module.Journal.sync, writer_module.Writer.respond

    def batch(self, lines):
        batches["seen"] += 1
        return original_batch(self, lines)

    def write(self, entries):
        if target == "after_apply" and armed():
            os.kill(os.getpid(), signal.SIGKILL)
        return original_write(self, entries)

    def append(self, data):
        if target == "half_frame" and armed():
            os.write(self.fd, data[:len(data) // 2])
            os.kill(os.getpid(), signal.SIGKILL)
        return original_append(self, data)

    def sync(self):
        original_sync(self)
        if target == "after_sync" and armed():
            os.kill(os.getpid(), signal.SIGKILL)

    def respond(self, lines):
        if target == "half_acks" and armed() and len(lines) > 1:
            original_respond(self, lines[:len(lines) // 2])
            os.kill(os.getpid(), signal.SIGKILL)
        return original_respond(self, lines)

    writer_module.Writer.batch = batch
    writer_module.Journal.write = write
    writer_module.Journal.append = append
    writer_module.Journal.sync = sync
    writer_module.Writer.respond = respond
