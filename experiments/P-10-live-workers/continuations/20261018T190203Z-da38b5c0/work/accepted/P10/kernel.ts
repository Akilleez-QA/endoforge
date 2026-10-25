export function celsiusToFahrenheit(c: f64): f64 {
  if (isNaN(c) || !isFinite(c) || c < -273.15 || c > 1000.0) {
    unreachable();
  }
  return c * 9.0 / 5.0 + 32.0;
}
