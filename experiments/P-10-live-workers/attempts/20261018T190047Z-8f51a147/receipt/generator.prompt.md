Return ONLY AssemblyScript source text (no Markdown or explanation) implementing the complete request below. No tools, libraries, imports, other exports or test data. Use unreachable() for refusal, not assert (asserts may compile away). The evaluator is independently generated and unavailable to you.

Implement one pure AssemblyScript function, exported exactly as:
export function celsiusToFahrenheit(c: f64): f64
Compute Fahrenheit as c * 9 / 5 + 32. Accept only finite Celsius values in the inclusive interval [-273.15, 1000]. For NaN, either infinity, or values outside this interval, trap using unreachable(). Maximum absolute numerical error: 1e-9. No defaults or other inputs. This closed-form conversion is the complete specification.
