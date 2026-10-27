/** What a thread did to files rather than to words (docs/ai-sidebar.md 4.5): a note
 *  moved or renamed, a note sent to Recently deleted. Auto and Full permissions do these without
 *  asking, so each is on the changes list beside the edits, with Undo and Keep, and a
 *  rewind takes them back too. Read off the thread's own tool rows, which say what each
 *  call did in the verb's own answer. Pure. */

import type { Part, Turn } from '../chat/types'

/** One file the thread moved or deleted. `path` is where it is now (moved) or was
 *  (deleted), relative to its space; `id` is the call's. */
export type FileChange =
  | { id: string; kind: 'moved'; from: string; path: string; space?: string }
  | { id: string; kind: 'trashed'; path: string; space?: string }

type Tool = Extract<Part, { kind: 'tool' }>

/** A tool's name as the app's verbs say it: Claude Code calls it `mcp__orden__move_file`. */
export function verbOf(name: string): string {
  const at = name.lastIndexOf('__')
  return at < 0 ? name : name.slice(at + 2)
}

/** The words of a call's answer, read as the JSON a window verb answers, or null. */
export function answerOf(part: Tool): Record<string, unknown> | null {
  try {
    const read: unknown = JSON.parse(part.result?.text ?? '')
    return typeof read === 'object' && read !== null ? (read as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function argsOf(part: Tool): Record<string, unknown> {
  return typeof part.args === 'object' && part.args !== null
    ? (part.args as Record<string, unknown>)
    : {}
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The space a call ran in: the one its answer says, else the one it named. A call
 *  that names none runs in the space in front at the time (agents/workspace/spaces.ts),
 *  which is not the thread's once the reader has switched, so the verbs that make, move
 *  and delete say its id. Empty for a call of before they did. */
export function spaceOfCall(part: Tool): string {
  return text(answerOf(part)?.space) || text(argsOf(part).space)
}

/** The space named by id or by name: the id first, which the verbs answer and which a
 *  rename keeps, then the exact name, then the name case aside, the way a verb finds one
 *  it is told (`placeFor`). On Linux two spaces can differ only by case. */
export function spaceNamed<T extends { id: string; name: string }>(
  spaces: readonly T[],
  named: string,
): T | undefined {
  const folded = named.trim().toLowerCase()
  return (
    spaces.find((one) => one.id === named) ??
    spaces.find((one) => one.name === named) ??
    spaces.find((one) => one.name.toLowerCase() === folded)
  )
}

/** What one call did to a file, or null for a call that did nothing of the kind. */
export function fileChangeOf(part: Tool): FileChange | null {
  if (part.state !== 'ok') return null
  const verb = verbOf(part.verb)
  const said = answerOf(part)
  const space = spaceOfCall(part)
  const where = space ? { space } : {}
  if (verb === 'move_file') {
    const from = text(said?.from)
    const to = text(said?.to)
    return from && to && from !== to
      ? { id: part.id, kind: 'moved', from, path: to, ...where }
      : null
  }
  if (verb === 'trash_file' && said?.trashed === true) {
    const path = text(said.path)
    return path ? { id: part.id, kind: 'trashed', path, ...where } : null
  }
  return null
}

/** Every file change in these turns, oldest first, but those in `done`: kept, or
 *  already taken back. */
export function fileChangesOf(turns: readonly Turn[], done: ReadonlySet<string>): FileChange[] {
  return turns
    .flatMap((turn) => turn.parts)
    .flatMap((part) => (part.kind === 'tool' ? [fileChangeOf(part)] : []))
    .filter((one): one is FileChange => one !== null && !done.has(one.id))
}
