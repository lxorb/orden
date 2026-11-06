import type { Entry } from './workspace.svelte'
import { byDefault, shownNames, type Row } from './tree-order'

function sortedFrom(rows: readonly Row[], at: number): boolean {
  for (let index = at + 1; index < rows.length; index++) {
    const before = rows[index - 1]
    const row = rows[index]
    if (before && row && byDefault(before, row) > 0) return false
  }

  return true
}

export function trimmed(children: readonly Entry[], names: readonly string[]): string[] {
  const of = new Map(children.map((one) => [one.name, one]))
  const rows = names.map((name) => of.get(name) ?? { name, is_dir: false })

  let at = rows.length
  while (at > 0 && sortedFrom(rows, at - 1)) at -= 1

  return names.slice(0, at)
}

export function movedTo(names: readonly string[], moving: readonly string[], at: number): string[] {
  const going = names.filter((name) => moving.includes(name))
  if (!going.length) return [...names]

  const kept = names.filter((name) => !going.includes(name))
  const before = names.slice(0, Math.max(0, at)).filter((name) => !going.includes(name)).length

  return [...kept.slice(0, before), ...going, ...kept.slice(before)]
}

export function stepped(names: readonly string[], name: string, by: number): string[] | null {
  const at = names.indexOf(name)
  if (at < 0) return null
  if (at + by < 0 || at + by >= names.length) return null

  return movedTo(names, [name], by < 0 ? at + by : at + by + 1)
}

export function placedBeside(
  children: readonly Entry[],
  listed: readonly string[],
  moving: readonly string[],
  target: string,
  after: boolean,
): string[] {
  const displayed = shownNames(children, 'manual', listed)
  const at = displayed.indexOf(target)
  if (at < 0) return trimmed(children, displayed)

  return trimmed(children, movedTo(displayed, moving, after ? at + 1 : at))
}
