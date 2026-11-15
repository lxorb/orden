export function ranked(
  strip: readonly string[],
  order: readonly string[],
  current: string,
): string[] {
  const used = order.filter((id) => id !== current && strip.includes(id))
  const rest = strip.filter((id) => id !== current && !used.includes(id))

  return [...(strip.includes(current) ? [current] : []), ...used, ...rest]
}

export function successor(
  left: readonly string[],
  order: readonly string[],
  at?: number,
): string | null {
  const recent = order.find((id) => left.includes(id))
  if (recent !== undefined) return recent
  if (at === undefined || at < 0) return left.at(-1) ?? null
  return left[at] ?? left[at - 1] ?? left.at(-1) ?? null
}

export class Walk {
  private at = 0
  private readonly order: string[]

  constructor(
    strip: readonly string[],
    current: string,
    private readonly before: readonly string[],
  ) {
    this.order = ranked(strip, before, current)
  }

  step(direction: number): string | null {
    const count = this.order.length
    if (count < 2) return null

    this.at = (((this.at + direction) % count) + count) % count
    return this.order[this.at] ?? null
  }

  ended(current: string | null): string[] {
    const rest = this.before.filter((id) => id !== current)
    return current === null ? rest : [current, ...rest]
  }
}
