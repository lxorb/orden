import type { Thread, Turn } from '../chat/types'

interface Spot {
  from: number
  to: number
  removed: string
  inserted: string
}

export interface Edit {
  id: string
  agent: string
  path: string
  at: number
  spots: readonly Spot[]
  thread?: string
}

export interface Change extends Edit {
  turn: string | null
  added: number
  removed: number
}

export interface NoteChanges {
  path: string
  agent: string
  changes: Change[]
  added: number
  removed: number
}

const AGENT = 'orden-'
const FORMER_AGENT = 'nib-'

export function agentOf(provider: string): string {
  return `${AGENT}${provider}`
}

export function agentsOf(provider: string): string[] {
  return [agentOf(provider), `${FORMER_AGENT}${provider}`]
}

export function providerOf(agent: string): string | null {
  const prefix = [AGENT, FORMER_AGENT].find((one) => agent.startsWith(one))
  return prefix ? agent.slice(prefix.length) : null
}

export function linesOf(words: string): number {
  if (!words) return 0
  const lines = words.split('\n').length
  return words.endsWith('\n') ? lines - 1 : lines
}

export function providersOf(thread: Pick<Thread, 'provider' | 'turns'>): string[] {
  const all = new Set([thread.provider])
  for (const turn of thread.turns)
    if (turn.role === 'model' && turn.provider) all.add(turn.provider)
  return [...all]
}

export function checkpoints(turns: readonly Turn[]): Turn[] {
  return turns.filter((turn) => turn.role === 'you' && !turn.steered)
}

export function answered(turns: readonly Turn[], at: number): string | null {
  let found: string | null = null
  for (const turn of checkpoints(turns)) if (turn.at <= at) found = turn.id
  return found
}

export type Reviewed = Pick<Thread, 'id' | 'provider' | 'turns'> & { helpers?: readonly string[] }

export function changesOf(
  thread: Reviewed,
  edits: readonly Edit[],
  answering: (provider: string, at: number) => string | null,
  kept: ReadonlySet<string>,
): Change[] {
  const threads = new Set([thread.id, ...(thread.helpers ?? [])])
  const changes: Change[] = []
  for (const edit of edits) {
    if (kept.has(edit.id)) continue
    const provider = providerOf(edit.agent)
    if (provider === null) continue
    const by = edit.thread ?? answering(provider, edit.at)
    if (by === null || !threads.has(by)) continue
    changes.push({
      ...edit,
      turn: answered(thread.turns, edit.at),
      added: edit.spots.reduce((sum, spot) => sum + linesOf(spot.inserted), 0),
      removed: edit.spots.reduce((sum, spot) => sum + linesOf(spot.removed), 0),
    })
  }
  return changes.sort((one, other) => one.at - other.at)
}

export function byNote(changes: readonly Change[]): NoteChanges[] {
  const notes = new Map<string, NoteChanges>()
  for (const change of changes) {
    const key = `${change.agent}\n${change.path}`
    const note = notes.get(key) ?? {
      path: change.path,
      agent: change.agent,
      changes: [],
      added: 0,
      removed: 0,
    }
    note.changes.push(change)
    note.added += change.added
    note.removed += change.removed
    notes.set(key, note)
  }
  return [...notes.values()]
}

export function changesSince(
  changes: readonly Change[],
  turns: readonly Turn[],
  turn: string,
): Change[] {
  const marks = checkpoints(turns).map((one) => one.id)
  const from = marks.indexOf(turn)
  if (from < 0) return []
  const after = new Set(marks.slice(from))
  return changes.filter((change) => change.turn !== null && after.has(change.turn))
}
