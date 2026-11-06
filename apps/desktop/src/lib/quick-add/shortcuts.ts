import { locksHere, locksWork } from '../locks'
import { log } from '../log'
import { invoke as crate } from '../native'
import { hearHere } from '../own-window'
import { nameOf, within } from '../space-paths'
import { joinPath } from '../tauri'

const TAKING = 'nib:shortcuts-added'

const ADDED = 'nib://shortcuts-added'

export const TAKEN = '.shortcuts'

const OPEN_TASK = /^\s*[-*+]\s+\[ \]\s+(.+?)\s*$/

interface Added {
  id: string
  text: string
}

type Add = (text: string) => Promise<boolean>

async function addedHere(text: string): Promise<boolean> {
  const { addTask } = await import('../task-actions')
  return (await addTask(text, { typed: false })) !== null
}

function addedOf(said: unknown): Added[] {
  if (!Array.isArray(said)) return []
  return said.filter(
    (one): one is Added =>
      typeof one === 'object' &&
      one !== null &&
      typeof (one as Added).id === 'string' &&
      typeof (one as Added).text === 'string',
  )
}

async function waiting(add: Add): Promise<number> {
  let count = 0
  for (const one of addedOf(await crate<unknown>('shortcuts_added').catch(() => []))) {
    if (!(await add(one.text))) break
    await crate('shortcuts_added_taken', { id: one.id }).catch(() => undefined)
    count += 1
  }
  return count
}

const textOf = (path: string) => crate<string>('read_note', { path }).catch(() => null)

function lineCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const key = line.trim()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function tasksSince(before: string, now: string): string[] {
  const had = lineCounts(before)
  const out: string[] = []
  for (const line of now.split(/\r?\n/)) {
    const key = line.trim()
    const left = had.get(key) ?? 0
    if (left > 0) {
      had.set(key, left - 1)
      continue
    }
    const task = OPEN_TASK.exec(line)?.[1]
    if (task) out.push(task)
  }
  return out
}

async function backupOf(from: string, rest: string): Promise<string | null> {
  const { HOME } = await import('../internal/spaces')
  const backups = joinPath(joinPath(await crate<string>('spaces_root'), HOME), '.backups')
  const tree = await crate<{ children?: { name: string; path: string; is_dir: boolean }[] }>(
    'read_tree',
    { root: backups, options: { every: true } },
  ).catch(() => null)
  const named = `${nameOf(from)} `
  const found = (tree?.children ?? [])
    .filter((one) => one.is_dir && one.name.startsWith(named))
    .sort((a, b) => (a.name < b.name ? 1 : -1))
  for (const one of found) {
    const text = await textOf(joinPath(one.path, rest))
    if (text !== null) return text
  }
  return null
}

async function leftBehind(add: Add): Promise<number> {
  const left = await crate<string | null>('shortcuts_left_inbox').catch(() => null)
  if (!left) return 0
  const [{ keptCameFrom }, { mountOf }] = await Promise.all([
    import('../internal/spaces'),
    import('../internal/roots'),
  ])
  for (const { root, from } of await keptCameFrom()) {
    const rest = within(from, left)
    const kept = mountOf(root)?.mount.folder
    if (!rest || !kept) continue
    const now = await textOf(left)
    if (now === null) return 0
    const marker = joinPath(kept.name, TAKEN)
    const before =
      (await textOf(marker)) ?? (await backupOf(from, rest)) ?? (await kept.readText(rest)) ?? ''
    if (before === now) return 0
    let count = 0
    for (const task of tasksSince(before, now)) {
      if (!(await add(task))) return count
      count += 1
    }
    await crate('write_note', { path: marker, content: now })
    return count
  }
  return 0
}

async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const locks = locksHere()
  if (!locks || !(await locksWork(locks))) return run()
  return locks.request(TAKING, run) as Promise<T>
}

export function takeAdded(add: Add = addedHere): Promise<number> {
  return exclusive(async () => {
    const behind = await leftBehind(add).catch((error: unknown) => {
      log('warn', `shortcuts: the old inbox was not read: ${String(error)}`)
      return 0
    })
    return behind + (await waiting(add))
  })
}

export async function hearShortcuts(): Promise<void> {
  await takeAdded()
  await hearHere(ADDED, () => void takeAdded())
}
