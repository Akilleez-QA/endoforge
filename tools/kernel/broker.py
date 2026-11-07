DECLARED_IMPORTS = ("endoforge:kernel/buffers@1.0.0",)
MAX_HOST_CALLS = 4096
MAX_DENIALS = 64


class BrokerDenied(PermissionError):
    def __init__(self, report):
        self.report = report
        super().__init__(report["denials"][-1]["reason"])


class Broker:
    def __init__(self, snapshots, byte_limit, authorize, max_calls):
        if type(max_calls) is not int or not 1 <= max_calls <= MAX_HOST_CALLS:
            raise ValueError("host-call limit must be between 1 and 4096")
        if authorize is not None and not callable(authorize):
            raise ValueError("authority checker must be callable")
        self._snapshots = snapshots
        self._authorize = authorize
        self._remaining = byte_limit
        self._byte_limit = byte_limit
        self._max_calls = max_calls
        self._calls = 0
        self._denial_count = 0
        self._denials = []

    def report(self):
        return {"host_calls": self._calls, "host_call_limit": self._max_calls,
                "buffer_bytes_read": self._byte_limit - self._remaining,
                "denial_count": self._denial_count,
                "denials": [dict(entry) for entry in self._denials]}

    def deny(self, operation, handle, reason, *, fatal=True):
        self._denial_count += 1
        entry = {"operation": operation, "handle": handle, "reason": reason}
        if len(self._denials) == MAX_DENIALS:
            self._denials[-1] = entry
        else:
            self._denials.append(entry)
        if fatal:
            raise BrokerDenied(self.report())
        return reason

    def _source(self, operation, handle):
        if self._calls >= self._max_calls:
            self.deny(operation, handle, "host-call-limit")
        self._calls += 1
        if type(handle) is not int or not 0 <= handle < len(self._snapshots):
            self.deny(operation, handle, "foreign-or-stale-handle")
        if self._authorize is not None:
            try:
                allowed = self._authorize(handle, operation)
            except Exception:
                allowed = False
            if allowed is not True:
                self.deny(operation, handle, "authority-denied")
        return self._snapshots[handle]

    def size(self, handle):
        return len(self._source("size", handle))

    def read(self, handle, offset, length):
        data = self._source("read", handle)
        if offset < 0 or length < 0 or offset > len(data) or length > len(data) - offset:
            return self.deny("read", handle, "out-of-bounds", fatal=False)
        if length > self._remaining:
            return self.deny("read", handle, "limit-exceeded", fatal=False)
        self._remaining -= length
        return data[offset:offset + length]
