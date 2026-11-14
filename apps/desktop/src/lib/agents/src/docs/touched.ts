import { SvelteMap } from 'svelte/reactivity'

export interface Touched {
  id: string
  name: string
  edits: number
}

const byNote = new SvelteMap<string, readonly Touched[]>()

export function touchedBy(path: string | null | undefined): readonly Touched[] {
  return path ? (byNote.get(path) ?? []) : []
}

export function touch(path: string, agent: { id: string; name: string }, edits: number): void {
  const others = (byNote.get(path) ?? []).filter((one) => one.id !== agent.id)
  const was = byNote.get(path)?.findIndex((one) => one.id === agent.id) ?? -1
  const now: Touched[] = [...others]
  if (edits > 0) now.splice(was === -1 ? now.length : was, 0, { ...agent, edits })

  if (now.length) byNote.set(path, now)
  else byNote.delete(path)
}

export function touchedMoved(from: string, to: string, agent: string): Touched | null {
  const row = byNote.get(from)?.find((one) => one.id === agent)
  if (!row) return null
  const before = byNote.get(to)?.find((one) => one.id === agent) ?? null
  touch(from, row, 0)
  touch(to, row, row.edits)
  return before
}
