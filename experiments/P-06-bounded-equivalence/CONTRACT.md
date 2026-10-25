# Contract: `convert` (pressure, fixed-point milli-units)

Pure function, no state, no ambient authority. One WebAssembly export:

```
convert(value: i32, fromUnit: i32, toUnit: i32, basis: i32) -> i32
```

`fromUnit`, `toUnit`, `basis` are `u8` codes carried in `i32` parameters; any value outside the listed codes (including negative `i32` values) is invalid.

## Units and scale

`value` and the result are **milli-units**: 1 unit = 1000 milli-units.

| Code | Unit | Exact factor `K[u]` = kPa per unit × 10^6 |
|---|---|---|
| 0 | kPa | 1 000 000 |
| 1 | psi | 6 894 757 (1 psi = 6.894757 kPa) |
| 2 | bar | 100 000 000 (1 bar = 100 kPa) |
| 3 | inHg | 3 386 389 (1 inHg = 3.386389 kPa at 0 °C) |

The factors are the contract; their physical accuracy is not.

## Basis

| Code | Meaning |
|---|---|
| 0 | Same basis: output = input scaled (gauge→gauge or absolute→absolute). |
| 1 | Input is gauge, output is absolute: add one standard atmosphere, exactly 101.325 kPa = 101 325 milli-kPa, before scaling to `toUnit`. |

## Exact semantics

Let `K` be the table above. All arithmetic is exact (mathematical integers / rationals); implementations may use `i64` because every intermediate fits: `|value| × K[u] ≤ 2^31 × 10^8 < 2^58`.

1. If `fromUnit ∉ {0,1,2,3}` or `toUnit ∉ {0,1,2,3}` or `basis ∉ {0,1}`: return `ERR = INT32_MIN = -2 147 483 648`.
2. `num = value × K[fromUnit] + basis × 101 325 × K[0]`
3. `den = K[toUnit]` (always positive)
4. `exact = num / den` as a rational.
5. `q = round_half_even(exact)`: the nearest integer; when `exact` is exactly halfway between two integers, the even one. Equivalently, with `f = floor(num / den)` and `r = num − f × den` (so `0 ≤ r < den`): `q = f` if `2r < den`; `q = f + 1` if `2r > den`; if `2r = den` then `q = f` when `f` is even, else `f + 1`.
6. Saturate: if `q > INT32_MAX` return `INT32_MAX = 2 147 483 647`; if `q < INT32_MIN + 1` return `INT32_MIN + 1 = -2 147 483 647`. `INT32_MIN` itself is never a valid result; it is reserved for `ERR`.
7. Otherwise return `q`.

## Worked examples

- `convert(1000, 1, 0, 0)` (1.000 psi → kPa) = `round_half_even(1000 × 6 894 757 / 1 000 000)` = `round_half_even(6894.757)` = `6895`.
- `convert(0, 0, 0, 1)` (0 kPa gauge → kPa absolute) = `101325`.
- `convert(500, 0, 2, 0)` (0.500 kPa → bar) = `round_half_even(500 × 10^6 / 10^8)` = `round_half_even(5)` = `5`.
- `convert(50, 0, 2, 0)` = `round_half_even(0.5)` = `0` (tie, even). `convert(150, 0, 2, 0)` = `round_half_even(1.5)` = `2`.
- `convert(-50, 0, 2, 0)` = `round_half_even(-0.5)` = `0`; `convert(-150, 0, 2, 0)` = `-2`.
- `convert(2 147 483 647, 2, 0, 0)` saturates to `2 147 483 647`; `convert(-2 147 483 648, 2, 0, 0)` saturates to `-2 147 483 647`.
- `convert(1, 4, 0, 0)` = `ERR`.

## Bounded domain checked by this probe

All 32 valid `(fromUnit, toUnit, basis)` combinations × `value ∈ [-2^20, 2^20)` = 67 108 864 inputs. Everything outside that range (except the saturation and invalid-code spot checks) is **unchecked**.
