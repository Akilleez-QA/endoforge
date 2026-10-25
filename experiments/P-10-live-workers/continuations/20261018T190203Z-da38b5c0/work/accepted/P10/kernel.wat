(module
 (type $0 (func (param f64) (result f64)))
 (memory $0 0)
 (export "celsiusToFahrenheit" (func $experiments/P-10-live-workers/continuations/20261018T190203Z-da38b5c0/work/accepted/P10/kernel/celsiusToFahrenheit))
 (export "memory" (memory $0))
 (func $experiments/P-10-live-workers/continuations/20261018T190203Z-da38b5c0/work/accepted/P10/kernel/celsiusToFahrenheit (param $0 f64) (result f64)
  local.get $0
  local.get $0
  f64.sub
  f64.const 0
  f64.ne
  local.get $0
  local.get $0
  f64.ne
  i32.or
  local.get $0
  f64.const -273.15
  f64.lt
  i32.or
  local.get $0
  f64.const 1e3
  f64.gt
  i32.or
  if
   unreachable
  end
  local.get $0
  f64.const 9
  f64.mul
  f64.const 5
  f64.div
  f64.const 32
  f64.add
 )
)
