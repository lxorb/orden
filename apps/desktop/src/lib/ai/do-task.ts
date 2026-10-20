/** A task done with AI (#325): a chat of its own, started out of sight and in the panel's
 *  list like any other, which works on the task in the mode Settings › AI › Do with AI
 *  says, Auto unless another was picked, and ticks it once it is sure it is done. */

import type { Row } from '@nib/bases'
import { atOf } from '@nib/bases/tasks'
import { plain } from '../views/inline'
import { workspace } from '../workspace.svelte'
import { taskMode } from './sidebar/prefs'

/** What the model is asked before the task. In English, for the model. */
const ASK = [
  'Do this task from my notes for me.',
  'Read its note first: what is written around and under the task may be what it needs.',
  'When it is done and you are sure it is, tick it with update_task (done: true) at the place below.',
  'If what it asks is unclear, or you need something from me, leave it open and say what you need.',
].join(' ')

/** The words a task is handed over in: what to do, then where it is. */
export function askOf(row: Row, words: string): string {
  return `${ASK}\n\nTask: ${words}\nSpace: ${row.space}\nNote: ${row.path}\nAt: ${atOf(row)}`
}

/** Starts the task's chat, titled with its words; nothing where its space is gone. */
export async function doWithAi(row: Row, words: string): Promise<void> {
  const space = workspace.spaces.find((one) => one.name === row.space)
  if (!space) return
  const { chat } = await import('./sidebar/chat.svelte')
  void chat.startAside(space.id, plain(words), taskMode(), askOf(row, words))
}
