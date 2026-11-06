import type { Thread, Turn } from '../chat/types'

interface Fork {
  tails: Turn[][]
  at: number
}

export type Branched = Thread & { branches?: Record<string, Fork> }

function keyAt(turns: readonly Turn[], index: number): string {
  return turns[index - 1]?.id ?? ''
}

export function forkAt(thread: Branched, turn: string): { count: number; at: number } | null {
  const index = thread.turns.findIndex((one) => one.id === turn)
  if (index < 0) return null
  const fork = thread.branches?.[keyAt(thread.turns, index)]
  return fork && fork.tails.length > 1 ? { count: fork.tails.length, at: fork.at } : null
}

export function cutForEdit(thread: Branched, turn: string): Turn[] | null {
  const index = thread.turns.findIndex((one) => one.id === turn)
  if (index < 0) return null
  const key = keyAt(thread.turns, index)
  const tail = thread.turns.splice(index)
  const branches = (thread.branches ??= {})
  const fork = branches[key]
  if (fork) {
    fork.tails[fork.at] = tail
    fork.tails.push([])
    fork.at = fork.tails.length - 1
  } else {
    branches[key] = { tails: [tail, []], at: 1 }
  }
  return tail
}

export function switchBranch(thread: Branched, turn: string, step: number): boolean {
  const index = thread.turns.findIndex((one) => one.id === turn)
  if (index < 0) return false
  const fork = thread.branches?.[keyAt(thread.turns, index)]
  const to = (fork?.at ?? 0) + step
  const next = fork?.tails[to]
  if (!fork || !next) return false

  fork.tails[fork.at] = thread.turns.splice(index)
  thread.turns.push(...next)
  fork.at = to
  return true
}
