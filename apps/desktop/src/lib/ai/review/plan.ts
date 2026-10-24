/** What rewinding a thread to one of the reader's messages would do (docs/ai-sidebar.md
 *  4.5): Claude Code's five choices, which of them there is anything for, the changes
 *  the notes made, moved and deleted since, and whether the thread did anything since
 *  that a rewind cannot take back - a page clicked, a form filled, a command run - which
 *  the sheet says in one line, as Copilot does. Pure. */

import type { Part, Thread, Turn } from '../chat/types'
import { type Change, changesSince, checkpoints } from './changes'
import { answerOf, argsOf, type FileChange, fileChangeOf, verbOf } from './files'

/** Claude Code's five, in its order. */
export type Choice = 'both' | 'conversation' | 'notes' | 'summarize-from' | 'summarize-to'

/** A file a tool call made: where the call said, relative to its space. */
export interface Made {
  path: string
  space?: string
}

export interface Plan {
  turn: Turn
  changes: Change[]
  made: Made[]
  /** Notes moved or deleted since, oldest first. */
  files: FileChange[]
  /** Whether something since cannot be taken back. */
  lasting: boolean
  choices: Choice[]
}

/** The verbs that only look. */
const LOOKS =
  /^(read_|list_|search_|get_|pdf_highlights$|approval_status$|agent_status$|browser_(snapshot|read|find|screenshot|console|network|tabs|wait|downloads)$)/

/** The verbs whose edits the review takes back: through the agent's own steps. */
const EDITS = new Set(['edit_note', 'write_note', 'append_note', 'set_property', 'set_task'])

/** The verbs whose files the review moves back or brings back (files.ts). */
const MOVES = new Set(['move_file', 'trash_file'])

/** What a call made that a rewind sends to Recently deleted, or null: only a note,
 *  canvas, page or web note `create_note` says it made, at the path it answered. A
 *  folder is not a file, and `create_folder` answers a folder's path even when the
 *  folder was there already; read as a note's name, `Projects` became the reader's own
 *  `Projects.md`, sent to Recently deleted on every device. */
function madeBy(part: Extract<Part, { kind: 'tool' }>): Made | null {
  if (verbOf(part.verb) !== 'create_note') return null
  const args = argsOf(part)
  const said = answerOf(part)
  if (said?.created !== true) return null
  const path = said.path
  if (typeof path !== 'string' || !path) return null
  return typeof args.space === 'string' && args.space ? { path, space: args.space } : { path }
}

/** The calls the thread made in answer to `turn` and every message after it. */
function callsSince(turns: readonly Turn[], turn: string): Extract<Part, { kind: 'tool' }>[] {
  const at = turns.findIndex((one) => one.id === turn)
  if (at < 0) return []
  return turns
    .slice(at)
    .flatMap((one) => one.parts)
    .filter((part): part is Extract<Part, { kind: 'tool' }> => part.kind === 'tool')
    .filter((part) => part.state === 'ok')
}

/** The plan for rewinding `thread` to before its message `turn`; null for a turn that
 *  is not one of the reader's messages with a checkpoint. `done` are the file changes
 *  already kept or taken back. */
export function planFor(
  thread: Pick<Thread, 'turns'>,
  turn: string,
  changes: readonly Change[],
  done: ReadonlySet<string> = new Set(),
): Plan | null {
  const marks = checkpoints(thread.turns)
  const at = marks.findIndex((one) => one.id === turn)
  const found = marks[at]
  if (!found) return null

  const since = changesSince(changes, thread.turns, turn)
  const made: Made[] = []
  const files: FileChange[] = []
  let lasting = false
  for (const part of callsSince(thread.turns, turn)) {
    const verb = verbOf(part.verb)
    if (LOOKS.test(verb) || EDITS.has(verb)) continue
    const file = madeBy(part)
    const moved = fileChangeOf(part)
    if (file) made.push(file)
    else if (moved) {
      if (!done.has(moved.id)) files.push(moved)
    } else if (!MOVES.has(verb)) lasting = true
  }

  const notes = since.length > 0 || made.length > 0 || files.length > 0
  const choices: Choice[] = [
    ...(notes ? (['both'] as const) : []),
    'conversation',
    ...(notes ? (['notes'] as const) : []),
    'summarize-from',
    ...(at > 0 ? (['summarize-to'] as const) : []),
  ]
  return { turn: found, changes: since, made, files, lasting, choices }
}
