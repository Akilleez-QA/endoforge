wit_bindgen::generate!({ path: "../kernel/kernel.wit", world: "kernel", skip: ["reduce"] });

use endoforge::kernel::buffers::Buffer;
use exports::endoforge::kernel::reducer::{Guest, Metadata};

struct Kernel;

fn convert(value: i32, from: i32, to: i32, basis: i32) -> i32 {
    const K: [i64; 4] = [1_000_000, 6_894_757, 100_000_000, 3_386_389];
    if !(0..=3).contains(&from) || !(0..=3).contains(&to) || !(0..=1).contains(&basis) {
        return i32::MIN;
    }
    let num = value as i64 * K[from as usize] + basis as i64 * 101_325 * K[0];
    let den = K[to as usize];
    let mut q = num.div_euclid(den);
    let r = num.rem_euclid(den);
    if 2 * r > den || (2 * r == den && q & 1 != 0) {
        q += 1;
    }
    q.clamp(i32::MIN as i64 + 1, i32::MAX as i64) as i32
}

static mut RESULT: [u32; 5] = [0; 5];

#[export_name = "endoforge:kernel/reducer@1.0.0#reduce"]
pub unsafe extern "C" fn reduce(state: *mut u8, state_len: usize,
    event: *mut u8, event_len: usize, inputs: *mut u32, inputs_len: usize) -> *mut u32 {
    let mut event = if event_len == 0 { Vec::new() } else {
        Vec::from_raw_parts(event, event_len, event_len)
    };
    if state_len > 0 {
        drop(Vec::from_raw_parts(state, state_len, state_len));
    }
    if event.is_empty() && inputs_len == 1 {
        let buffer = std::mem::ManuallyDrop::new(Buffer::from_handle(*inputs));
        if buffer.size() == 16 {
            event = buffer.read(0, 16).unwrap_or_default();
        }
    }
    if inputs_len > 0 {
        drop(Vec::from_raw_parts(inputs, inputs_len, inputs_len));
    }
    let mut result = i32::MIN;
    if event.len() == 16 {
        let mut args = [0; 4];
        for (i, bytes) in event.chunks_exact(4).enumerate() {
            args[i] = i32::from_le_bytes(bytes.try_into().unwrap());
        }
        result = convert(args[0], args[1], args[2], args[3]);
    }
    let area = (&raw mut RESULT).cast::<u32>();
    area.write(result as u32);
    area.add(1).write(area as u32);
    area.add(2).write(4);
    area.add(1)
}

impl Guest for Kernel {
    fn describe() -> Metadata {
        Metadata {
            contract_version: "1.0.0".into(),
            state_schema: "p06-result-i32le-v1".into(),
            event_schema: "p06-args-4xi32le-v1".into(),
            effect_schema: "empty-v1".into(),
        }
    }
}

export!(Kernel);
