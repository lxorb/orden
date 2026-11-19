import { runCommand } from '@orden/contracts'
import { addEntry, type Todo } from '../../tasks-model/src/api'
import type { Entry } from './entry'

let adding: Promise<unknown> = Promise.resolve()
export async function addTask(entry: Entry, options: { open?: boolean } = {}): Promise<Todo | null> {
  const added = adding.then(() => addEntry(entry))
  adding = added.catch(() => undefined)
  const landed = await added
  if (landed && options.open) {
    await runCommand('views.todos')
  }
  return landed
}
