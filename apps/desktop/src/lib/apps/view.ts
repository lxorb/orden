export const SETTLE = 150

export function refreshRate(gaps: readonly number[]): number | null {
  if (gaps.length < 8) return null
  const sorted = [...gaps].sort((one, other) => one - other)
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0
  if (middle <= 0) return null
  const hz = Math.round(1000 / middle)
  return hz >= 24 && hz <= 500 ? hz : null
}

export class Settling<T> {
  private cancel: (() => void) | null = null

  constructor(
    private readonly say: (value: T) => void,
    private readonly after: (ms: number, run: () => void) => () => void,
  ) {}

  saw(value: T): void {
    this.cancel?.()
    this.cancel = this.after(SETTLE, () => {
      this.cancel = null
      this.say(value)
    })
  }

  end(): void {
    this.cancel?.()
    this.cancel = null
  }
}
