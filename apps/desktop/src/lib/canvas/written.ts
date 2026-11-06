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
    const now = after[run] ?? []
    const size = before.sizes[run] ?? 0
    const shortest = Math.min(was.length, now.length)

    let front = 0
    let from = base
    while (front < shortest && was[front] === now[front]) from += was[front++]?.length ?? 0

    let back = 0
    let to = base + size
    while (back < shortest - front && was[was.length - 1 - back] === now[now.length - 1 - back]) {
      to -= was[was.length - 1 - back]?.length ?? 0
      back++
    }

    if (front + back < was.length || front + back < now.length) {
      out.push({ from, to, insert: now.slice(front, now.length - back).join('') })
    }
    base += size
  })

  return out
}
