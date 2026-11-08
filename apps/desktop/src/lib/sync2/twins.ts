import { folderOf, joined, nameOf, type SpaceState } from './places'

const NUMBERED = /^(.+) ([2-9]|[1-9]\d+)(\.[^. ]+)$/

export interface Twin {
  from: string
  to: string
}

export function madeTwice(space: SpaceState): Twin[] {
  const entries = [...space.entries.values()]
  const out: Twin[] = []
  for (const twin of entries) {
    if (twin.kind !== 'file' || twin.deleted || !twin.local_path || !twin.written_hash) continue
    const numbered = NUMBERED.exec(nameOf(twin.local_path))
    if (!numbered) continue
    const first = `${numbered[1] ?? ''}${numbered[3] ?? ''}`
    const to = joined(folderOf(twin.local_path), first)
    if (space.at(to) || out.some((one) => space.key(one.to) === space.key(to))) continue
    const lost = entries.some(
      (one) =>
        one !== twin &&
        one.kind === 'file' &&
        one.deleted &&
        !one.local_path &&
        one.parent === twin.parent &&
        space.key(one.name) === space.key(first) &&
        one.written_hash === twin.written_hash,
    )
    if (lost) out.push({ from: twin.local_path, to })
  }
  return out
}
