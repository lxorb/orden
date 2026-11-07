export interface Replacement {
  from: number
  to: number
  insert: string
}

export interface Written {
  runs: readonly (readonly string[])[]
  sizes: readonly number[]
  text: string
}

export function written(runs: readonly (readonly string[])[]): Written {
  const texts = runs.map((run) => run.join(''))
  return { runs, sizes: texts.map((text) => text.length), text: texts.join('') }
}

export function changesBetween(
  before: Written,
  after: readonly (readonly string[])[],
): Replacement[] | null {
  if (before.runs.length !== after.length) return null

  const out: Replacement[] = []
  let base = 0

  before.runs.forEach((was, run) => {
    for (const change of runChanges(was, after[run] ?? [], base)) out.push(change)
    base += before.sizes[run] ?? 0
  })

  return out
}

function runChanges(was: readonly string[], now: readonly string[], base: number): Replacement[] {
  const out: Replacement[] = []
  let inNow: Map<string, number[]> | null = null
  let inWas: Map<string, number[]> | null = null
  let one = 0
  let other = 0
  let at = base
  let since = { other, at }

  const settle = () => {
    if (at === since.at && other === since.other) return
    const insert = now.slice(since.other, other).join('')
    if (at === since.at && !insert) return

    const last = out.at(-1)
    if (last?.to === since.at)
      out[out.length - 1] = { ...last, to: at, insert: last.insert + insert }
    else out.push({ from: since.at, to: at, insert })
  }

  const drop = (to: number) => {
    for (; one < to; one++) at += was[one]?.length ?? 0
  }

  while (one < was.length || other < now.length) {
    const left = was[one]
    const right = now[other]

    if (left === undefined) {
      other = now.length
    } else if (right === undefined) {
      drop(was.length)
    } else if (left === right) {
      settle()
      drop(one + 1)
      other++
      since = { other, at }
    } else {
      inNow ??= places(now)
      inWas ??= places(was)
      const ahead = nextOf(inNow, left, other)
      const behind = nextOf(inWas, right, one)
      if (ahead < 0) drop(one + 1)
      else if (behind < 0) other = ahead
      else if (alignsOn(inNow, left, inWas, right, ahead - other, behind - one)) other = ahead
      else drop(behind)
    }
  }
  settle()

  return out
}

function alignsOn(
  inNow: Map<string, number[]>,
  left: string,
  inWas: Map<string, number[]>,
  right: string,
  added: number,
  dropped: number,
): boolean {
  const common = inNow.get(left)?.length ?? 0
  const rare = inWas.get(right)?.length ?? 0
  return common === rare ? added <= dropped : common < rare
}

function places(items: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  items.forEach((item, at) => {
    const held = out.get(item)
    if (held) held.push(at)
    else out.set(item, [at])
  })
  return out
}

function nextOf(places: Map<string, number[]>, item: string, from: number): number {
  const held = places.get(item)
  if (!held) return -1

  let low = 0
  let high = held.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((held[middle] ?? 0) < from) low = middle + 1
    else high = middle
  }
  return held[low] ?? -1
}
