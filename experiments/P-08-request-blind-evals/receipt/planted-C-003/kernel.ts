// C-003: dew point from dry-bulb temperature (F) and relative humidity (%).
// Magnus form, Alduchov-Eskridge coefficients (a = 17.625, b = 253.04 C), over liquid water.
// rhPercent must satisfy 0 < rh <= 100 and all inputs finite; otherwise the call traps (refusal).

const MAGNUS_A: f64 = 17.625;
const MAGNUS_B: f64 = 253.04;

export function dewPointF(tF: f64, rhPercent: f64): f64 {
  if (isNaN(tF) || !isFinite(tF) || isNaN(rhPercent) || !isFinite(rhPercent)) unreachable();
  if (rhPercent <= 0.0 || rhPercent > 100.0) unreachable();
  const tC: f64 = (tF - 32.0) * 5.0 / 9.0;
  const gamma: f64 = Math.log(rhPercent / 100.0) + MAGNUS_A * tC / (MAGNUS_B + tC);
  const dC: f64 = MAGNUS_B * gamma / (MAGNUS_A - gamma);
  return dC * 9.0 / 5.0 + 32.0;
}
