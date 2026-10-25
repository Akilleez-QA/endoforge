//! P-01 Wasmtime crate host: compile once, instantiate N times (timed), hold K instances (RSS).
//! Usage: p01-wasmtime-host <wasm-path> <mode> <count> [repeat] [--pooling]
//!   mode = instantiate : N timed Instance::new into fresh Stores; prints JSON lines {i,ns} to stdout
//!   mode = resident    : hold K instances alive, print one JSON summary line with RSS before/after
//!   mode = call        : 10,000 timed calls of step on one instance; prints {i,ns} lines
use std::time::Instant;
use wasmtime::*;

fn vmrss_bytes() -> u64 {
    let s = std::fs::read_to_string("/proc/self/status").unwrap();
    for l in s.lines() {
        if let Some(rest) = l.strip_prefix("VmRSS:") {
            let kb: u64 = rest.trim().trim_end_matches(" kB").trim().parse().unwrap();
            return kb * 1024;
        }
    }
    0
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = &args[1];
    let mode = args[2].as_str();
    let count: usize = args[3].parse().unwrap();
    let repeat: usize = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(0);
    let pooling = args.iter().any(|a| a == "--pooling");

    let mut config = Config::new();
    if pooling {
        let mut pool = PoolingAllocationConfig::default();
        pool.total_memories(6000).total_tables(6000).total_core_instances(6000);
        config.allocation_strategy(InstanceAllocationStrategy::Pooling(pool));
    }
    let engine = Engine::new(&config).unwrap();
    let t0 = Instant::now();
    let module = Module::from_file(&engine, path).unwrap();
    let compile_ns = t0.elapsed().as_nanos();
    let linker: Linker<()> = Linker::new(&engine);
    // The kernel has no imports; keep a Linker so an `env.abort` variant would still link.

    match mode {
        "instantiate" => {
            // warm-up
            for _ in 0..50 {
                let mut store = Store::new(&engine, ());
                let _ = linker.instantiate(&mut store, &module).unwrap();
            }
            let mut keep = Vec::with_capacity(count);
            let mut samples = Vec::with_capacity(count);
            for _ in 0..count {
                let mut store = Store::new(&engine, ());
                let a = Instant::now();
                let inst = linker.instantiate(&mut store, &module).unwrap();
                let ns = a.elapsed().as_nanos();
                samples.push(ns);
                keep.push((store, inst));
            }
            for (i, ns) in samples.iter().enumerate() {
                println!("{{\"i\":{},\"ns\":{}}}", i, ns);
            }
            eprintln!("{{\"compileNs\":{},\"pooling\":{},\"kept\":{}}}", compile_ns, pooling, keep.len());
        }
        "resident" => {
            // warm-up and drop
            {
                let mut warm = Vec::new();
                for _ in 0..20 {
                    let mut store = Store::new(&engine, ());
                    let inst = linker.instantiate(&mut store, &module).unwrap();
                    warm.push((store, inst));
                }
            }
            let before = vmrss_bytes();
            let a = Instant::now();
            let mut live = Vec::with_capacity(count);
            for _ in 0..count {
                let mut store = Store::new(&engine, ());
                let inst = linker.instantiate(&mut store, &module).unwrap();
                let init = inst.get_typed_func::<u32, u32>(&mut store, "initState").unwrap();
                init.call(&mut store, 0).unwrap();
                live.push((store, inst));
            }
            let wall_ns = a.elapsed().as_nanos();
            let after = vmrss_bytes();
            let delta = after as i64 - before as i64;
            println!(
                "{{\"host\":\"wasmtime-crate\",\"pooling\":{},\"K\":{},\"repeat\":{},\"rssBefore\":{},\"rssAfter\":{},\"deltaRss\":{},\"bytesPerInstanceRss\":{},\"wallNsTotal\":{},\"live\":{},\"compileNs\":{}}}",
                pooling, count, repeat, before, after, delta, delta as f64 / count as f64, wall_ns, live.len(), compile_ns
            );
        }
        "call" => {
            let mut store = Store::new(&engine, ());
            let inst = linker.instantiate(&mut store, &module).unwrap();
            let step = inst.get_typed_func::<(u32, u32), u32>(&mut store, "step").unwrap();
            let init = inst.get_typed_func::<u32, u32>(&mut store, "initState").unwrap();
            let mem = inst.get_memory(&mut store, "memory").unwrap();
            init.call(&mut store, 0).unwrap();
            let event_ptr: u32 = 240;
            let kinds = [1u32, 2, 3, 4];
            let write_event = |store: &mut Store<()>, i: usize| {
                let d = mem.data_mut(store);
                let base = event_ptr as usize;
                d[base..base + 4].copy_from_slice(&kinds[i & 3].to_le_bytes());
                d[base + 4..base + 8].copy_from_slice(&1u32.to_le_bytes());
                d[base + 8..base + 12].copy_from_slice(&0u32.to_le_bytes());
                d[base + 12..base + 16].copy_from_slice(&(i as u32).to_le_bytes());
                d[base + 16..base + 24].copy_from_slice(&((i as f64) * 0.5).to_le_bytes());
                d[base + 24..base + 32].copy_from_slice(&1.0f64.to_le_bytes());
            };
            for i in 0..1000 { write_event(&mut store, i); step.call(&mut store, (0, event_ptr)).unwrap(); }
            let mut samples = Vec::with_capacity(count);
            for i in 0..count {
                write_event(&mut store, i);
                let a = Instant::now();
                step.call(&mut store, (0, event_ptr)).unwrap();
                samples.push(a.elapsed().as_nanos());
            }
            for (i, ns) in samples.iter().enumerate() { println!("{{\"i\":{},\"ns\":{}}}", i, ns); }
            let read_mass = inst.get_typed_func::<u32, f64>(&mut store, "readMass").unwrap();
            eprintln!("{{\"massAfterKg\":{}}}", read_mass.call(&mut store, 0).unwrap());
        }
        _ => panic!("unknown mode"),
    }
}
