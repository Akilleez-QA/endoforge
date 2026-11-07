//! Rust implementation of CONTRACT.md `convert`. First version (v1), written directly from the contract.

/// kPa per unit × 10^6 for codes 0..3 (kPa, psi, bar, inHg).
const K: [i64; 4] = [1_000_000, 6_894_757, 100_000_000, 3_386_389];
const ERR: i32 = i32::MIN;
const ATM_MILLI_KPA: i64 = 101_325;

#[no_mangle]
pub extern "C" fn convert(value: i32, from_unit: i32, to_unit: i32, basis: i32) -> i32 {
    if !(0..=3).contains(&from_unit) || !(0..=3).contains(&to_unit) || !(0..=1).contains(&basis) {
        return ERR;
    }
    let mut num = value as i64 * K[from_unit as usize];
    if basis == 1 {
        num += ATM_MILLI_KPA * K[0];
    }
    let den = K[to_unit as usize];
    let q = num / den; // SEEDED FAULT: truncation toward zero instead of round-half-even
    q.clamp(i32::MIN as i64 + 1, i32::MAX as i64) as i32
}
