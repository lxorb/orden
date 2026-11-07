const ROUNDS = 6

const LEAST_MS = 4

export const GROWS_AT_MOST = 12

export function measuredGrowth(measure: (size: number) => number, size: number, times = 4): number {
  const small = () => {
    let spent = 0
    for (let one = 0; one < times; one++) spent += measure(size)
    return spent
  }
  small()
  measure(size * times)
  let least = Infinity
  let most = Infinity
  for (let round = 0; round < ROUNDS; round++) {
    least = Math.min(least, small())
    most = Math.min(most, measure(size * times))
  }
  return (times * most) / Math.max(least, 0.05)
}

function repeated(run: () => unknown, count: number): number {
  const start = performance.now()
  for (let one = 0; one < count; one++) run()
  return performance.now() - start
}

export function growth(run: (size: number) => unknown, size: number, times = 4): number {
  let count = 1
  while (count < 1024 && repeated(() => run(size), count) < LEAST_MS) count *= 2
  return measuredGrowth((one) => repeated(() => run(one), count), size, times)
}

export function linearly<T>(run: (size: number) => T, size: number): T {
  let result: T | undefined
  const ratio = growth((one) => (result = run(Math.ceil(one / 4))), size)
  if (ratio >= GROWS_AT_MOST) {
    throw new Error(`four times as much took ${ratio.toFixed(1)} times as long`)
  }
  return result as T
}
