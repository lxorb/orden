import { folderOf, nameOf } from '../space-paths'
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

export function isOneName(name: string): boolean {
  const clean = name.trim()
  return clean !== '' && clean !== '.' && clean !== '..' && !/[/\\\0]/.test(name)
}

function folderPart(relative: string): string {
  return relative.slice(0, relative.lastIndexOf('/') + 1)
}

export function clashing(
  names: readonly string[],
  next: readonly string[],
  taken: readonly string[],
  swapping = true,
): Set<number> {
  const leaving = new Set(swapping ? names.map((one) => one.toLowerCase()) : [])
  const staying = new Set(taken.map((one) => one.toLowerCase()).filter((one) => !leaving.has(one)))
  const seen = new Map<string, number>()
  const out = new Set<number>()
  next.forEach((name, at) => {
    const key = `${folderPart(names[at] ?? '')}${name}`.toLowerCase()
    const same = key === names[at]?.toLowerCase()
    if (!isOneName(name) || (staying.has(key) && !same)) out.add(at)
    const first = seen.get(key)
    if (first !== undefined) {
      out.add(first)
      out.add(at)
    } else seen.set(key, at)
  })
  return out
}

export function swapping(
  pairs: readonly { from: string; to: string }[],
  key: (path: string) => string,
): boolean {
  const leaving = new Map<string, number[]>()
  pairs.forEach(({ from }, at) => {
    const held = leaving.get(key(from))
    if (held) held.push(at)
    else leaving.set(key(from), [at])
  })
  return pairs.some(({ to }, at) => (leaving.get(key(to)) ?? []).some((there) => there !== at))
}

export function crossing(moving: readonly { from: string; name: string }[]): boolean {
  return swapping(
    moving.map(({ from, name }) => ({
      from: `${folderOf(from)}\0${nameOf(from)}`,
      to: `${folderOf(from)}\0${name}`,
    })),
    (one) => one.toLowerCase(),
  )
}
