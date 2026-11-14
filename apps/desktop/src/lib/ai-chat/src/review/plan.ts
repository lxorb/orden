import type { Part, Thread, Turn } from '../../../ai-providers/src/api'
import { type Change, changesSince, checkpoints } from './changes'
import { answerOf, type FileChange, fileChangeOf, spaceOfCall, verbOf } from './files'

export type Choice = 'both' | 'conversation' | 'notes' | 'summarize-from' | 'summarize-to'

export interface Made {
  id: string
  path: string
  space?: string
}

export type Step =
  | { kind: 'edits'; changes: Change[] }
  | { kind: 'file'; file: FileChange }
  | { kind: 'made'; made: Made }

export interface Plan {
  turn: Turn
  changes: Change[]
  made: Made[]
  files: FileChange[]
  steps: Step[]
  lasting: boolean
  choices: Choice[]
}

const LOOKS =
  /^(read_|list_|search_|get_|pdf_highlights$|approval_status$|agent_status$|browser_(snapshot|read|find|screenshot|console|network|tabs|wait|downloads)$)/

const EDITS = new Set(['edit_note', 'write_note', 'append_note', 'set_property', 'set_task'])

const MOVES = new Set(['move_file', 'trash_file'])

function madeBy(part: Extract<Part, { kind: 'tool' }>): Made | null {
  if (verbOf(part.verb) !== 'create_note') return null
  const said = answerOf(part)
  if (said?.created !== true) return null
  const path = said.path
  if (typeof path !== 'string' || !path) return null
  const space = spaceOfCall(part)
  return space ? { id: part.id, path, space } : { id: part.id, path }
}

function callsSince(turns: readonly Turn[], turn: string): Extract<Part, { kind: 'tool' }>[] {
  const at = turns.findIndex((one) => one.id === turn)
  if (at < 0) return []
  return turns
    .slice(at)
    .flatMap((one) => one.parts)
    .filter((part): part is Extract<Part, { kind: 'tool' }> => part.kind === 'tool')
    .filter((part) => part.state === 'ok')
}

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
  const acts: { at: number; step: Step }[] = []
  let lasting = false
  for (const part of callsSince(thread.turns, turn)) {
    const verb = verbOf(part.verb)
    if (LOOKS.test(verb) || EDITS.has(verb)) continue
    const file = madeBy(part)
    const moved = fileChangeOf(part)
    const at = part.at ?? 0
    if (file) {
      if (!done.has(file.id)) {
        made.push(file)
        acts.push({ at, step: { kind: 'made', made: file } })
      }
    } else if (moved) {
      if (!done.has(moved.id)) {
        files.push(moved)
        acts.push({ at, step: { kind: 'file', file: moved } })
      }
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
  return {
    turn: found,
    changes: since,
    made,
    files,
    steps: stepsBack(acts, since),
    lasting,
    choices,
  }
}

function stepsBack(
  acts: readonly { at: number; step: Step }[],
  changes: readonly Change[],
): Step[] {
  const steps: Step[] = []
  let left = [...changes]
  const edits = (these: Change[]) => {
    if (these.length) steps.push({ kind: 'edits', changes: these })
  }
  for (const { at, step } of [...acts].reverse()) {
    edits(left.filter((one) => one.at > at))
    left = left.filter((one) => one.at <= at)
    steps.push(step)
  }
  edits(left)
  return steps
}
