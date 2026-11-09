wit_bindgen::generate!({ path: "../kernel/kernel.wit", world: "kernel", skip: ["reduce"] });

use endoforge::kernel::buffers::Buffer;
use exports::endoforge::kernel::reducer::{Guest, Metadata};

struct Kernel;

const THRESHOLD: u64 = 1000;
const NOTIFY: &[u8] = b"notify";
const THRESHOLD_OPERATION: &[u8] = b"threshold";
const AUDIT: &[u8] = b"audit";
const MALFORMED: &[u8] = b"malformed";

static mut STATE: [u8; 8] = [0; 8];
static mut PAYLOAD: [u8; 32] = [0; 32];
static mut EFFECT: [u32; 6] = [0; 6];
static mut RESULT: [u32; 4] = [0; 4];

fn amounts(event: &[u8]) -> Option<u64> {
    if event.is_empty() || event.len() > 64 || event.len() % 4 != 0 {
        return None;
    }
    Some(event.chunks_exact(4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as u64).sum())
}

unsafe fn effect(capability: &[u8], operation: &[u8], payload: &[u8]) {
    let area = (&raw mut PAYLOAD).cast::<u8>();
    std::ptr::copy_nonoverlapping(payload.as_ptr(), area, payload.len());
    let record = (&raw mut EFFECT).cast::<u32>();
    for (i, value) in [capability.as_ptr() as u32, capability.len() as u32, operation.as_ptr() as u32,
                       operation.len() as u32, area as u32, payload.len() as u32].into_iter().enumerate() {
        record.add(i).write(value);
    }
}

#[export_name = "endoforge:kernel/reducer@1.0.0#reduce"]
pub unsafe extern "C" fn reduce(state: *mut u8, state_len: usize,
    event: *mut u8, event_len: usize, inputs: *mut u32, inputs_len: usize) -> *mut u32 {
    let state = if state_len == 0 { Vec::new() } else {
        Vec::from_raw_parts(state, state_len, state_len)
    };
    let mut event = if event_len == 0 { Vec::new() } else {
        Vec::from_raw_parts(event, event_len, event_len)
    };
    if event.is_empty() && inputs_len == 1 {
        let buffer = std::mem::ManuallyDrop::new(Buffer::from_handle(*inputs));
        let size = buffer.size();
        if (4..=64).contains(&size) {
            event = buffer.read(0, size as u32).unwrap_or_default();
        }
    }
    if inputs_len > 0 {
        for handle in Vec::from_raw_parts(inputs, inputs_len, inputs_len) {
            drop(Buffer::from_handle(handle));
        }
    }
    let before = if state.len() == 8 { u64::from_le_bytes(state[..].try_into().unwrap()) } else { 0 };
    let mut after = before;
    let mut count = 0;
    match amounts(&event) {
        Some(sum) => {
            after = before.saturating_add(sum);
            if before < THRESHOLD && after >= THRESHOLD {
                effect(NOTIFY, THRESHOLD_OPERATION, format!("{{\"total\":{after}}}").as_bytes());
                count = 1;
            }
        }
        None => {
            effect(AUDIT, MALFORMED, &(event.len() as u32).to_le_bytes());
            count = 1;
        }
    }
    let next = (&raw mut STATE).cast::<u8>();
    std::ptr::copy_nonoverlapping(after.to_le_bytes().as_ptr(), next, 8);
    let result = (&raw mut RESULT).cast::<u32>();
    result.write(next as u32);
    result.add(1).write(8);
    result.add(2).write((&raw mut EFFECT) as u32);
    result.add(3).write(count);
    result
}

impl Guest for Kernel {
    fn describe() -> Metadata {
        Metadata {
            contract_version: "1.0.0".into(),
            state_schema: "tally-total-u64le-v1".into(),
            event_schema: "tally-amounts-u32le-v1".into(),
            effect_schema: "tally-effects-v1".into(),
        }
    }
}

export!(Kernel);
