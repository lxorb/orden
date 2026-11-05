/** Which spaces on this desktop Orden keeps itself (#1068, step 4c), by their roots:
 *  what `invoke` asks before it sends a file command to the crate, so the commands for a
 *  path in one are answered by its folder instead (internal/route.ts). Handed to
 *  tauri.ts when the first is mounted, so nothing here is loaded before. */

import { internal } from '../tauri'
import type { InternalFolder } from './folder'

/** One space kept here, mounted. */
export interface Mounted {
  /** Its root, the address the rest of the app holds it by. */
  root: string
  /** The same space as the browser build's commands address it (`/<name>`). */
  web: string
  folder: InternalFolder
}

/** By root, spelled with `/` and nothing at the end. */
const mounted = new Map<string, Mounted>()

const spelled = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

export function mountRoot(one: Mounted): () => void {
  const key = spelled(one.root)
  mounted.set(key, one)
  internal.routed = forInternal
  internal.file = bytesOf
  return () => {
    if (mounted.get(key) === one) mounted.delete(key)
  }
}

/** The space kept here that `path` is the root of or is in, and where in it (`''` its
 *  root, `/` between folders). */
export function mountOf(path: string): { mount: Mounted; inside: string } | null {
  if (!mounted.size) return null
  const at = spelled(path)
  for (const [root, mount] of mounted) {
    if (at === root) return { mount, inside: '' }
    if (at.startsWith(`${root}/`)) return { mount, inside: at.slice(root.length + 1) }
  }
  return null
}

/** Every space kept here. */
export function mounts(): Mounted[] {
  return [...mounted.values()]
}

/** The file commands the browser build answers out of rows, and so a kept space's folder
 *  answers too: what a path in such a space is sent to. Versions, papers' words and the
 *  rest the crate keeps by path, apart from any file, stay the crate's. */
const FILE_COMMANDS = new Set([
  'read_note',
  'write_note',
  'write_bytes',
  'delete_note',
  'rename_note',
  'copy_path',
  'create_folder',
  'delete_folder',
  'remove_empty_folder',
  'read_tree',
  'path_exists',
  'space_tags',
  'scan_links',
  'trash_item',
  'trash_words',
  'save_asset',
  'read_highlights',
  'write_highlights',
  'read_asset',
  'read_file',
  'file_stamp',
])

/** Recently deleted, which holds what was deleted from every space at once. */
const TRASH_COMMANDS = new Set([
  'list_trash',
  'restore_trash',
  'purge_trash',
  'purge_trash_older_than',
])

/** The arguments a file command names a path in. */
export const PATH_ARGS = ['path', 'root', 'from', 'to', 'notePath'] as const

/** Whether a call is one a kept space answers, or has a part in. */
export function forInternal(command: string, args?: Record<string, unknown>): boolean {
  if (!mounted.size) return false
  if (TRASH_COMMANDS.has(command)) return true
  if (!FILE_COMMANDS.has(command) || !args) return false
  return PATH_ARGS.some((key) => {
    const value = args[key]
    return typeof value === 'string' && mountOf(value) !== null
  })
}

/** Where the bytes of the file at `path` are on this disk, for what reads a file by its
 *  own path (the asset protocol), or null where it is in no kept space or is no file. */
function bytesOf(path: string): string | null {
  const found = mountOf(path)
  const entry = found?.mount.folder.atNow(found.inside)
  return entry?.key ? (found?.mount.folder.bytes.where(entry.key) ?? null) : null
}
