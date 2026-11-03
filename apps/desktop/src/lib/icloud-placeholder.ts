/** A note iCloud took off this Mac, on macOS 13: `Plan.md` becomes `.Plan.md.icloud`, and
 *  no list holds it. See src-tauri/src/notes/icloud.rs. */

import { invoke, isNative } from './tauri'

/** Where iCloud's placeholder for a file would be, as `placeholder_of` has it. */
export function placeholderOf(path: string): string {
  const at = path.lastIndexOf('/') + 1
  return `${path.slice(0, at)}.${path.slice(at)}.icloud`
}

/** Whether a file that is not there has a placeholder that stands for it. A question that
 *  went wrong counts as yes: what a no starts is a delete on every device. */
export async function evictedHere(path: string): Promise<boolean> {
  if (!isNative) return false
  return invoke<boolean>('note_evicted', { path }).catch(() => true)
}
