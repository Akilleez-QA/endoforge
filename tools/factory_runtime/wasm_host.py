"""Runs one export of a core WebAssembly module under the hash-pinned Wasmtime wheel."""
import base64
import hashlib
from importlib.metadata import distribution
import json
import sys
import threading


def verify(expected):
    wheel = distribution('wasmtime')
    if wheel.version != expected:
        raise ValueError(f'wasmtime {expected} required, found {wheel.version}')
    for entry in wheel.files or []:
        if entry.hash and entry.suffix in ('.so', '.dylib', '.dll', '.py'):
            digest = hashlib.new(entry.hash.mode, entry.locate().read_bytes()).digest()
            if base64.urlsafe_b64encode(digest).rstrip(b'=').decode() != entry.hash.value:
                raise ValueError('wasmtime wheel content differs from its record: ' + str(entry))


def convert(raw, kind, ValType):
    if kind in (ValType.i32(), ValType.i64()):
        return int(raw)
    if kind in (ValType.f32(), ValType.f64()):
        return float(raw)
    raise ValueError('unsupported parameter type: ' + str(kind))


def execute(request):
    verify(request['version'])
    from wasmtime import Config, Engine, Func, Instance, Module, Store, ValType, wat2wasm
    config = Config()
    config.consume_fuel = True
    config.epoch_interruption = True
    config.parallel_compilation = False
    engine = Engine(config)
    with open(request['module'], 'rb') as source:
        binary = source.read()
    if not binary.startswith(b'\0asm'):
        binary = wat2wasm(binary.decode())
    module = Module(engine, binary)
    store = Store(engine)
    store.set_limits(memory_size=request['memory'], memories=1, instances=1, tables=1, table_elements=1024)
    store.set_fuel(request['fuel'])
    store.set_epoch_deadline(1)
    instance = Instance(store, module, [])
    export = instance.exports(store).get(request['export'])
    if not isinstance(export, Func):
        raise ValueError('no such function export: ' + request['export'])
    params = export.type(store).params
    if len(params) != len(request['args']):
        raise ValueError('argument count differs from the export signature')
    values = [convert(raw, kind, ValType) for raw, kind in zip(request['args'], params)]
    timer = threading.Timer(request['epochMs'] / 1000, engine.increment_epoch)
    timer.daemon = True
    timer.start()
    try:
        result = export(store, *values)
    finally:
        timer.cancel()
    return [] if result is None else result if isinstance(result, list) else [result]


def main():
    try:
        results = execute(json.loads(sys.argv[1]))
    except Exception as error:
        sys.stderr.write(str(error)[:4000] + '\n')
        return 1
    for value in results:
        print(value)
    return 0


if __name__ == '__main__':
    sys.exit(main())
