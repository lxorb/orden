export interface Spelling {
  typed: string
  typedAt: number
}

export interface Walk extends Spelling {
  cursor: number | null
}

export interface Step {
  walk: Walk
  took: boolean
  chose?: number
  shut?: boolean
}

const SPELLING = 600

export function spelled(
  from: Spelling,
  key: string,
  at: number,
  labels: readonly string[],
): Spelling & { found: number } {
  const typed = (at - from.typedAt > SPELLING ? '' : from.typed) + key.toLowerCase()
  const found = labels.findIndex((one) => one.trim().toLowerCase().startsWith(typed))

  return { typed, typedAt: at, found }
}

export function opensAt(index: number): Walk {
  return { cursor: index >= 0 ? index : null, typed: '', typedAt: 0 }
}

export function walk(key: string, at: number, labels: string[], from: Walk): Step {
  const stay = { ...from }
  if (!labels.length) return { walk: stay, took: false }

  const last = labels.length - 1
  const onto = (cursor: number): Step => ({ walk: { ...stay, cursor }, took: true })

  switch (key) {
    case 'ArrowDown':
      return onto(from.cursor === null ? 0 : (from.cursor + 1) % labels.length)
    case 'ArrowUp':
      return onto(from.cursor === null ? last : (from.cursor - 1 + labels.length) % labels.length)
    case 'Home':
      return onto(0)
    case 'End':
      return onto(last)
    case 'Enter':
    case ' ':
      return from.cursor === null
        ? { walk: stay, took: true, shut: true }
        : { walk: stay, took: true, chose: from.cursor, shut: true }
    case 'Tab':
      return { walk: stay, took: false, shut: true }
    default: {
      if (key.length !== 1) return { walk: stay, took: false }

      const { typed, typedAt, found } = spelled(from, key, at, labels)

      return { walk: { cursor: found >= 0 ? found : from.cursor, typed, typedAt }, took: true }
    }
  }
}
