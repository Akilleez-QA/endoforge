# CC-007: Refrigerant recirculation ratio

The model string `Frick SCS 46TH-DN-LB-HC-6EC6-GG-GR` alone does not
establish an operating recirculation ratio. No model-specific value is assumed.
This calculator requires measured or independently specified refrigerant flows;
it cannot answer the original equipment-only question without those inputs.

## Kernel
Implement a pure, constant-time AssemblyScript numeric kernel in `kernel.ts`.
Export exactly:
`recirculationRatio(circulatedKgPerS: f64, evaporatedKgPerS: f64): f64`.
Both parameters and the returned result are finite numeric scalars.
No lookup, model decoding, external state, iteration, or default flows are used.

## Definition and assumptions
Use the total-feed convention: R = circulatedKgPerS / evaporatedKgPerS.
The numerator is total liquid refrigerant delivered to the evaporator;
the denominator is refrigerant vaporized there, both in kg/s at steady state.
Flows must refer to the same circuit and operating condition.
R is dimensionless; R = 1 means all delivered refrigerant evaporates.
This is not the alternative excess-liquid-return / evaporation convention.
Each flow must be within [0.000001, 1000000], inclusive.
Also require circulatedKgPerS >= evaporatedKgPerS.
The permitted result range is [1, 1000000000000].

## Validation and presentation
Before division, trap if either flow is outside its inclusive bounds or if
circulatedKgPerS < evaporatedKgPerS. Trap message: `invalid refrigerant flows`.
Reject nonfinite inputs defensively; tests use only finite numeric arguments.
Compute with IEEE-754 f64 arithmetic, without intermediate rounding.
Display every numeric result with exactly 3 decimal places.
Test expectations represent unformatted numeric results; tol is absolute error.
