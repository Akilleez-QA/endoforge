// AssemblyScript implementation of CONTRACT.md `convert`. First version (v1), written directly from the contract.

const ERR: i32 = i32.MIN_VALUE;
const ATM_MILLI_KPA: i64 = 101325;

// K[u]: kPa per unit × 10^6
// @ts-ignore: decorator
@inline
function k(u: i32): i64 {
  switch (u) {
    case 0: return 1000000;
    case 1: return 6894757;
    case 2: return 100000000;
    default: return 3386389;
  }
}

export function convert(value: i32, fromUnit: i32, toUnit: i32, basis: i32): i32 {
  if (<u32>fromUnit > 3 || <u32>toUnit > 3 || <u32>basis > 1) return ERR;
  let num: i64 = <i64>value * k(fromUnit);
  if (basis == 1) num += ATM_MILLI_KPA * k(0);
  const den: i64 = k(toUnit);
  // floor division and non-negative remainder (i64 `/` truncates toward zero)
  let q: i64 = num / den;
  let r: i64 = num % den;
  if (r < 0) {
    r += den;
    q -= 1;
  }
  const twice: i64 = r << 1;
  if (twice > den || (twice == den && (q & 1) != 0)) q += 1;
  if (q > <i64>i32.MAX_VALUE) return i32.MAX_VALUE;
  if (q < <i64>i32.MIN_VALUE + 1) return i32.MIN_VALUE + 1;
  return <i32>q;
}
