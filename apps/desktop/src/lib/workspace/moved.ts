import { forget, keep, stored, storedText } from '../stored'
import { invoke, isMobile } from '../tauri'
import { noteRootsMoved, ROOTS_MOVED } from './roots-moved'
import { readSession } from './session'

export const SPACES_ROOT = 'nib:spaces-root'

function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : path
}

export function formerRoot(written: string | null, roots: readonly string[]): string | null {
  if (written) return written
  if (!roots.length) return null

  const parents = new Set(roots.map(parentOf))
  return parents.size === 1 ? ([...parents][0] ?? null) : null
}

export function hasMoved(
  was: string | null,
  now: string,
  roots: readonly string[],
  listed: readonly string[],
): was is string {
  if (!was || was === now || !roots.length) return false

  const there = new Set(listed)
  return roots.every((root) => root.startsWith(was) && there.has(now + root.slice(was.length)))
}

export function rebased(text: string, was: string, now: string): string {
  const escape = (path: string) => JSON.stringify(path).slice(1, -1)
  const under = (from: string, to: string, value: string) =>
    value
      .replaceAll(`${from}/`, `${to}/`)
      .replaceAll(`${from}\\`, `${to}\\`)
      .replaceAll(`"${from}"`, `"${to}"`)

  const plain = under(was, now, text)
  return escape(was) === was ? plain : under(escape(was), escape(now), plain)
}

export function restate(was: string, now: string, storage: Storage = localStorage): number {
  let changed = 0
  const keys: string[] = []
  for (let at = 0; at < storage.length; at++) {
    const key = storage.key(at)
    if (key?.startsWith('nib:') && key !== SPACES_ROOT && key !== ROOTS_MOVED) keys.push(key)
  }

  for (const key of keys) {
    const text = storage.getItem(key)
    if (text === null) continue
    const moved = rebased(text, was, now)
    if (moved === text) continue
    storage.setItem(key, moved)
    changed++
  }

  return changed
}

export function settleRoot(
  now: string,
  roots: readonly string[],
  listed: readonly string[],
): string | null {
  const written = storedText(SPACES_ROOT)
  const was = formerRoot(written, roots)

  if (hasMoved(was, now, roots, listed)) {
    try {
      restate(was, now)
    } catch {
      forget(SPACES_ROOT)
      return null
    }
    keep(SPACES_ROOT, now)
    return was
  }

  if (written !== now) keep(SPACES_ROOT, now)
  return null
}

export async function spacesMoved(): Promise<boolean> {
  if (!isMobile) return false

  const roots = readSession(stored('nib:workspace'))?.spaces.map((space) => space.root) ?? []
  try {
    const [now, listed] = await Promise.all([
      invoke<string>('spaces_root'),
      invoke<{ name: string; path: string }[]>('list_spaces'),
    ])
    const was = settleRoot(
      now,
      roots,
      listed.map((one) => one.path),
    )
    if (was === null) return false

    await invoke<number>('rehome_snapshots', { from: was, to: now }).catch(() => 0)
    noteRootsMoved([{ from: was, to: now }])
    return true
  } catch {
    return false
  }
}
