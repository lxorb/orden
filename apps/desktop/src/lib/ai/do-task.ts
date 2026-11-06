import type { Row } from '@orden/bases'
import { atOf } from '@orden/bases/tasks'
import type { Turn } from './chat/types'
import type { Ended } from './commands/types'
import { AGENT_WINDOW_VERBS, BROWSER_VERBS } from '../agents/verbs'
import { NEEDS_INPUT } from '../views/task-body'
import { plain } from '../views/inline'
import { workspace } from '../workspace.svelte'
import {
  DEFAULT_ASK,
  TASK_TOOLS,
  type TaskTool,
  taskAsk,
  taskMode,
  taskUses,
} from './sidebar/prefs'

export { sentOff } from './sent-off'

const FINISH = [
  'When it is done and you are sure it is, tick it with update_task (done: true) at the place below.',
  'If you are not sure, or what it asks is unclear, or you need something from me, leave it open:',
  `call update_task at the place below with a comment that says what you need, and with its tags plus "${NEEDS_INPUT}".`,
  'Always end with one of these two update_task calls: words in this chat alone are never read.',
].join(' ')

export function askOf(row: Row, words: string, ask = DEFAULT_ASK): string {
  const own = ask.trim() || DEFAULT_ASK
  return `${own}\n\n${FINISH}\n\nTask: ${words}\nSpace: ${row.space}\nNote: ${row.path}\nAt: ${atOf(row)}`
}

const TOOLS_OF: Record<TaskTool, () => string[]> = {
  browser: () => BROWSER_VERBS.filter((one) => one.startsWith('browser_')),
  notes: () => verbsOf('notes.read').filter((one) => one !== 'read_note' && one !== 'list_tasks'),
  edits: () =>
    [...verbsOf('notes.write'), ...verbsOf('tree')].filter((one) => one !== 'update_task'),
}

function verbsOf(scope: string): string[] {
  return Object.entries(AGENT_WINDOW_VERBS)
    .filter(([, needs]) => needs === scope)
    .map(([verb]) => verb)
}

export function keptOut(off: readonly TaskTool[]): string[] {
  return off.flatMap((one) => TOOLS_OF[one]())
}

export async function doWithAi(row: Row, words: string): Promise<boolean> {
  const space = workspace.spaces.find((one) => one.name === row.space)
  if (!space) return false
  const { chat } = await import('./sidebar/chat.svelte')
  const without = keptOut(TASK_TOOLS.filter((one) => !taskUses(one)))
  void chat
    .startAside(space.id, plain(words), taskMode(), askOf(row, words, taskAsk()), without)
    .then((ended) => heldToIt(row, ended))
    .catch(() => undefined)
  return true
}

async function heldToIt(row: Row, ended: Ended): Promise<void> {
  if (ended.stop !== 'end') return
  const { leaveAsked } = await import('../views/act')
  await leaveAsked(row, lastWords(ended.turn))
}

export function lastWords(turn: Turn | null): string {
  const said = (turn?.parts ?? []).filter((part) => part.kind === 'text')
  const last = said.at(-1)
  return last?.kind === 'text' ? last.text.trim() : ''
}
