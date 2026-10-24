/** A note read where a failed read must not pass for one that is not there: what
 *  every road that makes a note when a read fails asks first. Its own file so the
 *  first paint, which needs only `onDisk`, does not carry it. */
import { onDisk } from './on-disk'
import { invoke } from './tauri'

/** A file that is there and would not read as a note: written in an encoding that is
 *  not UTF-8, over the size the crate reads, or held by a cloud that cannot fetch it. */
export class Unreadable extends Error {
  constructor(readonly path: string) {
    super(`${path} is there and would not read, and nothing is written over it`)
    this.name = 'Unreadable'
  }
}

/** A note's words off the disk, null only where nothing is there.
 *
 *  A read that fails says nothing about why, and the two reasons are opposite: a note
 *  that is not there is one to make, and a note that is there and would not read is
 *  one a make would empty. So a failed read asks the disk, and a file it finds throws
 *  rather than passing for one that is missing. */
export async function readIfThere(path: string): Promise<string | null> {
  try {
    return await invoke<string>('read_note', { path })
  } catch {
    if (await onDisk(path)) throw new Unreadable(path)
    return null
  }
}

/** Passes on what a write that would have made a note threw, the reader told first
 *  where it was a note that is there and would not read: a task that went nowhere
 *  must not pass for one that was added. The toast is fetched with the first such
 *  note rather than carried in front of the first paint. */
export async function toldIfUnreadable(error: unknown): Promise<never> {
  if (error instanceof Unreadable) {
    const { unread } = await import('./unread.svelte')
    await unread.there(error.path)
  }
  throw error
}
