(module
 (type $0 (func (param f64) (result f64)))
 (memory $0 0)
 (export "celsiusToFahrenheit" (func $../out/P10/kernel/celsiusToFahrenheit))
 (export "memory" (memory $0))
 (func $../out/P10/kernel/celsiusToFahrenheit (param $0 f64) (result f64)
  f64.const 32
 )
)
