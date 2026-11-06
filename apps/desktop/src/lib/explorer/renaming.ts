import { endingOf } from './order'

export interface Renaming {
  find: string
  replace: string
  numbered: boolean
}

function split(name: string): { stem: string; ending: string } {
  const ending = endingOf(name)
  return ending
    ? { stem: name.slice(0, -(ending.length + 1)), ending: `.${name.slice(-ending.length)}` }
    : { stem: name, ending: '' }
}

export function renamedAll(names: readonly string[], how: Renaming): string[] {
  const digits = String(names.length).length
  return names.map((name, at) => {
    const { stem, ending } = split(name)
    let next = how.find ? stem.split(how.find).join(how.replace) : stem
    if (how.numbered) next = `${next} ${String(at + 1).padStart(digits, '0')}`
    return `${next.trim() || stem}${ending}`
  })
}

export function clashing(
  names: readonly string[],
  next: readonly string[],
  taken: readonly string[],
): Set<number> {
  const leaving = new Set(names.map((one) => one.toLowerCase()))
  const staying = new Set(taken.map((one) => one.toLowerCase()).filter((one) => !leaving.has(one)))
  const seen = new Map<string, number>()
  const out = new Set<number>()
  next.forEach((name, at) => {
    const key = name.toLowerCase()
    if (staying.has(key)) out.add(at)
    const first = seen.get(key)
    if (first !== undefined) {
      out.add(first)
      out.add(at)
    } else seen.set(key, at)
  })
  return out
}
