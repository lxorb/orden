export interface Picked {
  names: ReadonlySet<string>
  cursor: string | null
  anchor: string | null
}
export const NOTHING: Picked = { names: new Set(), cursor: null, anchor: null }
export type How = 'one' | 'range' | 'toggle' | 'move'
export function pickedAt(from: Picked, names: readonly string[], name: string, how: How): Picked {
  switch (how) {
    case 'one':
      return { names: new Set([name]), cursor: name, anchor: name }
    case 'move':
      return { ...from, cursor: name }
    case 'toggle': {
      const next = new Set(from.names)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return { names: next, cursor: name, anchor: name }
    }
    case 'range': {
      const anchor = from.anchor ?? from.cursor ?? name
      const one = names.indexOf(anchor)
      const other = names.indexOf(name)
      if (one < 0 || other < 0) return pickedAt(from, names, name, 'one')
      const [low, high] = one < other ? [one, other] : [other, one]
      return { names: new Set(names.slice(low, high + 1)), cursor: name, anchor }
    }
  }
}
export const pickedOnly = (names: readonly string[]): Picked => ({
  names: new Set(names),
  cursor: names.at(-1) ?? null,
  anchor: names[0] ?? null,
})
export const pickedAll = (from: Picked, names: readonly string[]): Picked => ({
  names: new Set(names),
  cursor: from.cursor ?? names[0] ?? null,
  anchor: from.anchor,
})
export function stillThere(from: Picked, names: readonly string[], before: readonly string[] = names): Picked {
  const here = new Set(names)
  const kept = new Set([...from.names].filter((one) => here.has(one)))
  const anchor = from.anchor !== null && here.has(from.anchor) ? from.anchor : null
  if (from.cursor === null || here.has(from.cursor)) return { names: kept, cursor: from.cursor, anchor }
  const nearest = nearestOf(from.cursor, here, before)
  if (nearest === null) return { names: kept, cursor: null, anchor }
  return kept.size
    ? { names: kept, cursor: nearest, anchor }
    : { names: new Set([nearest]), cursor: nearest, anchor: nearest }
}
function nearestOf(gone: string, here: ReadonlySet<string>, before: readonly string[]): string | null {
  const at = before.indexOf(gone)
  if (at < 0) return null
  const after = before.slice(at + 1).find((one) => here.has(one))
  return (
    after ??
    before
      .slice(0, at)
      .reverse()
      .find((one) => here.has(one)) ??
    null
  )
}
