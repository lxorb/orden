import { isAccountInbox } from '@orden/bases/inbox'
import { onDisk } from './on-disk'
import { invoke } from './tauri'
import { readText } from './workspace/in-turn'

class Unreadable extends Error {
  constructor(readonly path: string) {
    super(`${path} is there and would not read, and nothing is written over it`)
    this.name = 'Unreadable'
  }
}

export async function readIfThere(path: string): Promise<string | null> {
  if (isAccountInbox(path)) return readText(path)
  try {
    return await invoke<string>('read_note', { path })
  } catch {
    if (await onDisk(path)) throw new Unreadable(path)
    return null
  }
}

export async function toldIfUnreadable(error: unknown): Promise<never> {
  if (error instanceof Unreadable) {
    const { unread } = await import('./unread.svelte')
    await unread.there(error.path)
  }
  throw error
}
