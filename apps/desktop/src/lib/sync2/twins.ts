import { folderOf, joined, nameOf, type SpaceState } from './places'

const NUMBERED = /^(.+) ([2-9]|[1-9]\d+)(\.[^. ]+)$/

export interface Twin {
  from: string
  to: string
}

export function madeTwice(space: SpaceState): Twin[] {
  const entries = [...space.entries.values()]
  const lost = new Map<string, Set<string>>()
  for (const one of entries) {
    if (one.kind !== 'file' || !one.deleted || one.local_path || !one.written_hash) continue
    const at = `${one.parent ?? ''}\u0000${space.key(one.name)}`
    const hashes = lost.get(at) ?? new Set<string>()
    hashes.add(one.written_hash)
    lost.set(at, hashes)
  }
  const out: Twin[] = []
  if (!lost.size) return out
  const chosen = new Set<string>()
  for (const twin of entries) {
    if (twin.kind !== 'file' || twin.deleted || !twin.local_path || !twin.written_hash) continue
    const numbered = NUMBERED.exec(nameOf(twin.local_path))
    if (!numbered) continue
    const first = `${numbered[1] ?? ''}${numbered[3] ?? ''}`
    const hashes = lost.get(`${twin.parent ?? ''}\u0000${space.key(first)}`)
    if (!hashes?.has(twin.written_hash)) continue
    const to = joined(folderOf(twin.local_path), first)
    if (space.at(to) || chosen.has(space.key(to))) continue
    chosen.add(space.key(to))
    out.push({ from: twin.local_path, to })
  }
  return out
}
