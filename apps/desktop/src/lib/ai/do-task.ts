/** A task done with AI (#325): a chat of its own, started out of sight and in the panel's
 *  list like any other, which works on the task in the mode Settings › AI › Do with AI
 *  says, Auto unless another was picked. It ticks the task once it is sure it is done;
 *  otherwise it asks in a comment under it and flags it `needs-input`, which the
 *  reader's own comment there takes off again (views/act.ts). */

import type { Row } from '@nib/bases'
import { atOf } from '@nib/bases/tasks'
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

/** The press's answer, in the chunk the button already loads. */
export { sentOff } from './sent-off'

/** How the task is left, whatever it was asked: the button's promise, so the reader's own
 *  words cannot take it away. */
const FINISH = [
  'When it is done and you are sure it is, tick it with update_task (done: true) at the place below.',
  'If you are not sure, or what it asks is unclear, or you need something from me, leave it open:',
  `call update_task at the place below with a comment that says what you need, and with its tags plus "${NEEDS_INPUT}".`,
].join(' ')

/** The words a task is handed over in: what to do, how to leave it, then where it is. */
export function askOf(row: Row, words: string, ask = DEFAULT_ASK): string {
  const own = ask.trim() || DEFAULT_ASK
  return `${own}\n\n${FINISH}\n\nTask: ${words}\nSpace: ${row.space}\nNote: ${row.path}\nAt: ${atOf(row)}`
}

/** The tools each switch in Settings stands for. The task's own note and the task itself
 *  are always reached: `read_note`, `list_tasks` and `update_task` are in none of them. */
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

/** The tools a task's chat is not given, for the switches turned off. */
export function keptOut(off: readonly TaskTool[]): string[] {
  return off.flatMap((one) => TOOLS_OF[one]())
}

/** Starts the task's chat, titled with its words; false where its space is gone. */
export async function doWithAi(row: Row, words: string): Promise<boolean> {
  const space = workspace.spaces.find((one) => one.name === row.space)
  if (!space) return false
  const { chat } = await import('./sidebar/chat.svelte')
  const without = keptOut(TASK_TOOLS.filter((one) => !taskUses(one)))
  void chat.startAside(space.id, plain(words), taskMode(), askOf(row, words, taskAsk()), without)
  return true
}
