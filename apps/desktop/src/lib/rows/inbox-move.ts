import { withTasksOf } from '@orden/bases/inbox'
import { insideSpace, samePath } from '../space-paths'
import { chosenInbox, INBOX, OLD_INBOX } from './inbox'

export interface Moving {
  read(path: string): Promise<string | null>
  write(path: string, text: string, made: boolean): Promise<void>
  remove(path: string): Promise<void>
}

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/

export function madeByOrden(text: string): boolean {
  let inTask = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue
    if (TASK.test(line)) {
      inTask = true
      continue
    }
    if (inTask && /^\s/.test(line)) continue
    return false
  }
  return true
}

export type Moved = 'moved' | 'kept' | 'none'

export async function moveOldInbox(root: string, moving: Moving): Promise<Moved> {
  const chosen = chosenInbox(root)
  if (chosen !== null && samePath(chosen, OLD_INBOX, root)) return 'kept'

  const old = insideSpace(root, OLD_INBOX)
  const words = await moving.read(old)
  if (words === null) return 'none'
  if (!madeByOrden(words)) return 'kept'

  const own = insideSpace(root, INBOX)
  const before = await moving.read(own)
  const after = withTasksOf(before ?? '', words)
  if (after !== (before ?? '')) await moving.write(own, after, before === null)

  if ((await moving.read(old)) !== words) return 'kept'
  await moving.remove(old)
  return 'moved'
}
