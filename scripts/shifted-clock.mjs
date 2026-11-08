const at = process.env.ORDEN_TEST_CLOCK

const SHIFTED = Symbol.for('orden.shifted-clock')

if (at && !globalThis[SHIFTED]) {
  globalThis[SHIFTED] = true
  const Real = globalThis.Date
  const target = Real.parse(at)
  if (Number.isNaN(target)) throw new Error(`ORDEN_TEST_CLOCK is not a date: ${at}`)
  const realNow = Real.now
  const offset = target - realNow()
  const now = () => realNow() + offset
  Real.now = now
  globalThis.Date = new Proxy(Real, {
    construct: (date, args, made) => Reflect.construct(date, args.length ? args : [now()], made),
    apply: () => new Real(now()).toString(),
  })
}
