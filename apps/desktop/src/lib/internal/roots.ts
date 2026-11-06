import { internal } from '../tauri'
import type { InternalFolder } from './folder'

export interface Mounted {
  root: string
  web: string
  folder: InternalFolder
}

const mounted = new Map<string, Mounted>()

const spelled = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

export function mountRoot(one: Mounted): () => void {
  const key = spelled(one.root)
  mounted.set(key, one)
  internal.routed = forInternal
  internal.file = bytesOf
  internal.flush = async () => {
    await Promise.all(mounts().map((mount) => mount.folder.flush()))
  }
  return () => {
    if (mounted.get(key) === one) mounted.delete(key)
  }
}

export function mountOf(path: string): { mount: Mounted; inside: string } | null {
  if (!mounted.size) return null
  const at = spelled(path)
  for (const [root, mount] of mounted) {
    if (at === root) return { mount, inside: '' }
    if (at.startsWith(`${root}/`)) return { mount, inside: at.slice(root.length + 1) }
  }
  return null
}

export function keptShaped(root: string): boolean {
  const parts = spelled(root).split('/')
  const name = parts.at(-1)
  return parts.length > 2 && parts.at(-3) === '.orden' && !!name && parts.at(-2) === name
}

export function mounts(): Mounted[] {
  return [...mounted.values()]
}

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

const TRASH_COMMANDS = new Set([
  'list_trash',
  'restore_trash',
  'purge_trash',
  'purge_trash_older_than',
])

const ON_DISK: Record<string, string> = {
  pty_spawn: 'folder',
  same_pdf: 'space',
  remember_inbox: 'path',
}

export const PATH_ARGS = ['path', 'root', 'from', 'to', 'notePath'] as const

export function forInternal(command: string, args?: Record<string, unknown>): boolean {
  if (!mounted.size) return false
  if (TRASH_COMMANDS.has(command)) return true
  const named = ON_DISK[command]
  if (named) return typeof args?.[named] === 'string' && !!mountOf(args[named])
  if (!FILE_COMMANDS.has(command) || !args) return false
  return PATH_ARGS.some((key) => {
    const value = args[key]
    return typeof value === 'string' && mountOf(value) !== null
  })
}

function bytesOf(path: string): string | null {
  const found = mountOf(path)
  const entry = found?.mount.folder.atNow(found.inside)
  return entry?.key ? (found?.mount.folder.bytes.where(entry.key) ?? null) : null
}
