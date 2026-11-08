# CC-026: R448A discharge-pressure identifiability

The stated superheated discharge temperature does not determine discharge pressure.
R448A pressure-temperature saturation lookup cannot be applied to a superheated
discharge temperature. No numeric pressure will be inferred or fabricated.
An independent measured discharge pressure, or sufficient additional state data
and a validated refrigerant-property model, is required to determine pressure.

## Pure bounded AssemblyScript kernel

Exports take finite numeric scalars and return finite numeric scalars only.
No I/O, state, property tables, iteration, or external dependencies are required.
Temperature scale is an integer code: 0 = degrees Fahrenheit; 1 = degrees Celsius.
The original unspecified “220 degree” is assumed Fahrenheit when represented as
`(220, 0)`; choosing Celsius does not resolve the missing pressure information.
R448A and the requester's assertion of superheated vapor are fixed context;
the kernel does not independently establish phase or safe operating conditions.

## Exports and formulas

`dischargeTemperatureF(temperature: f64, scale: i32): f64`
For scale 0, F = temperature; for scale 1, F = temperature * 9 / 5 + 32.
Evaluate using f64 arithmetic. Return F; display with 2 decimal places.
Reject scale codes other than 0 or 1. Reject F outside [-100, 500], inclusive.
This finite engineering input range is a software bound, not an operating limit.

`pressureStatus(temperature: f64, scale: i32): i32`
Apply exactly the same conversion and validation, then return code 1:
“Discharge pressure is indeterminate from superheated temperature alone.”
Display status as its label; if rendered numerically, show 0 decimal places.
There is deliberately no export returning a pressure or saturation-pressure proxy.

## Traps and tests

Both exports trap for an unsupported scale with message “Unsupported temperature scale”.
Both exports trap for converted F outside the bounds with message “Temperature out of range”.
Validate scale before temperature range. Callers must supply finite numeric inputs.
Tests cover the request, both scales, inclusive limits, and invalid inputs.
