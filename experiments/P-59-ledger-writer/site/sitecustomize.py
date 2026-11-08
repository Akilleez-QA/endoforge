import atexit
import ctypes
import json
import os
import resource
import signal
import sys
import time

output = os.environ.get("EF_P59_STATS")
if output:
    started = time.perf_counter()

    def finish():
        usage = resource.getrusage(resource.RUSAGE_SELF)
        try:
            syncs = ctypes.CDLL(None).sync_count()
        except AttributeError:
            syncs = None
        with open(os.path.join(output, f"python-{os.getpid()}.json"), "w") as handle:
            json.dump(dict(pid=os.getpid(), wall=time.perf_counter() - started, user=usage.ru_utime, system=usage.ru_stime,
                           max_rss_kib=usage.ru_maxrss, syncs=syncs), handle)

    atexit.register(finish)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
