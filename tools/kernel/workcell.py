import hashlib
from importlib.metadata import version
from threading import Lock
from time import perf_counter_ns

from wasmtime import Config, Engine, Store
from wasmtime.component import Component, Linker, ResourceHost, ResourceType

from tools.kernel.contract import CONTRACT_VERSION, validate_component
from tools.kernel.broker import Broker, DECLARED_IMPORTS, MAX_HOST_CALLS


RUNTIME_VERSION = "49.0.0"
MAX_INPUT = 1024 * 1024
BUFFER_TYPE = 1


class Workcell:
    def __init__(self, component, schemas, *, declared_imports=DECLARED_IMPORTS):
        if version("wasmtime") != RUNTIME_VERSION:
            raise ValueError(f"wasmtime {RUNTIME_VERSION} required")
        if len(schemas) != 3 or any(type(s) is not str or not s for s in schemas):
            raise ValueError("three frozen schema identities required")
        self._schemas = (CONTRACT_VERSION, *schemas)
        self.artifact = validate_component(component)
        if tuple(declared_imports) != DECLARED_IMPORTS:
            raise ValueError("kernel imports differ from candidate declaration")
        self.runtime = f"wasmtime-py/{RUNTIME_VERSION}/cranelift/fuel"
        self.cache_key = hashlib.sha256(
            (self.artifact["id"] + self.runtime).encode("ascii")
        ).hexdigest()
        config = Config()
        config.wasm_component_model = True
        config.consume_fuel = True
        config.parallel_compilation = False
        self._engine = Engine(config)
        started = perf_counter_ns()
        self._component = Component(self._engine, component)
        self.compile_ns = perf_counter_ns() - started
        self.compile_count = 1
        self._lock = Lock()

    def run(self, state, event, inputs=(), *, fuel=100000, memory_bytes=16 * MAX_INPUT,
            authorize=None, max_host_calls=MAX_HOST_CALLS):
        snapshots = tuple(inputs)
        if len(snapshots) > 64 or any(type(b) is not bytes for b in (state, event, *snapshots)):
            raise ValueError("immutable byte inputs required; at most 64 buffers")
        if sum(map(len, (state, event, *snapshots))) > MAX_INPUT:
            raise ValueError("input byte limit exceeded")
        if type(fuel) is not int or not 1 <= fuel <= 10000000:
            raise ValueError("fuel must be between 1 and 10000000")
        if type(memory_bytes) is not int or not 65536 <= memory_bytes <= 16 * MAX_INPUT:
            raise ValueError("memory_bytes must be between 65536 and 16777216")
        broker = Broker(snapshots, MAX_INPUT, authorize, max_host_calls)
        with self._lock, Store(self._engine) as store, Linker(self._engine) as linker:
            store.set_limits(memory_size=memory_bytes, memories=1, instances=16,
                             tables=1, table_elements=1024)
            store.set_fuel(fuel)
            def source_handle(context, handle):
                with handle.to_host(context) as host:
                    if host.type != BUFFER_TYPE:
                        broker.deny("buffer", host.rep, "foreign-or-stale-handle")
                    return host.rep

            with linker.root() as root:
                with root.add_instance("endoforge:kernel/buffers@1.0.0") as buffers:
                    buffers.add_resource("buffer", ResourceType.host(BUFFER_TYPE), lambda *_: None)
                    buffers.add_func("[method]buffer.size", lambda ctx, h: broker.size(source_handle(ctx, h)))
                    buffers.add_func("[method]buffer.read", lambda ctx, h, offset, length:
                                     broker.read(source_handle(ctx, h), offset, length))
            started = perf_counter_ns()
            instance = linker.instantiate(store, self._component)
            instantiate_ns = perf_counter_ns() - started
            with instance.get_export_index(store, "endoforge:kernel/reducer@1.0.0") as reducer:
                def call(name, *args):
                    with instance.get_export_index(store, name, reducer) as index:
                        function = instance.get_func(store, index)
                    result = function(store, *args)
                    function.post_return(store)
                    return result

                metadata = call("describe")
                fields = ("contract-version", "state-schema", "event-schema", "effect-schema")
                if tuple(getattr(metadata, field) for field in fields) != self._schemas:
                    raise ValueError("kernel metadata differs from admitted schemas")
                handles = [ResourceHost.own(i, BUFFER_TYPE).to_any(store) for i in range(len(snapshots))]
                try:
                    transition = call("reduce", state, event, handles)
                    for handle in handles:
                        handle.drop(store)
                finally:
                    for handle in handles:
                        handle.close()
            return {
                "state": transition.state,
                "effects": [{"capability": e.capability, "operation": e.operation,
                             "payload": e.payload} for e in transition.effects],
                "artifact_id": self.artifact["id"], "cache_key": self.cache_key,
                "instantiate_ns": instantiate_ns, "run_ns": perf_counter_ns() - started,
                "fuel_consumed": fuel - store.get_fuel(),
                "buffer_bytes_read": broker.report()["buffer_bytes_read"],
                "broker": broker.report(),
            }
