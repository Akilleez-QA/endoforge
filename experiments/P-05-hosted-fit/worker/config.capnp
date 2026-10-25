using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ (name = "shim", worker = .shim) ],
  sockets = [ (name = "http", address = "127.0.0.1:PORT", http = (), service = "shim") ],
  v8Flags = ["--max-old-space-size=128"],
);
const shim :Workerd.Worker = (
  modules = [
    (name = "shim.js", esModule = embed "shim.js"),
    (name = "core.js", esModule = embed "core.js"),
    (name = "ts_rust.size.wasm", wasm = embed "ts_rust.size.wasm"),
    (name = "kernel.wasm", wasm = embed "kernel.wasm"),
  ],
  compatibilityDate = "2026-09-01",
);
