import { idNumber, inBase, readBase, readAutomations, repeatDue, type Row } from '@orden/bases'
import { withProperties } from '@orden/bases/agent'
import { insideOnly } from '../automation/inside'
import { show } from '../reminders/platform'
import { rows } from '../rows/rows.svelte'
import { noteRowsOf, type RowsChange } from '../rows/store'
import { canWriteAt } from '../sharing.svelte'
import { insideSpace, within } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { writeEach } from './act'
import { type HeldBase, planned } from './automate'
import { guardedAt } from './guard'
import { contextFor } from './context'
import { leaveIdsBy } from './copied'
import { landing, onLanded } from './moving'
import { nowHere, todayHere } from './days'
import { templatesFolder, templateWords } from './templates'

const held = new Map<string, HeldBase>()

export function basesAre(paths: readonly string[]) {
  for (const path of [...held.keys()]) if (!paths.includes(path)) held.delete(path)
  for (const path of paths) if (!held.has(path)) void readHeld(path)
}

const running = (): boolean => held.size > 0

function heldIn(space: string): HeldBase[] {
  return [...held.entries()].flatMap(([path, one]) => {
    const base = one.space === space ? guardedAt(one.base, path) : null
    return base ? [{ ...one, base }] : []
  })
}
const ours = new Set<string>()
const waiting = new Map<
  string,
  {
    space: string
    path: string
    removed: readonly Row[]
    timer?: ReturnType<typeof setTimeout>
    at?: string
  }
>()

const SETTLE = 80

const keyOf = (space: string, path: string) => `${space}\n${path}`

function clock() {
  const now = nowHere()
  return { today: now.slice(0, 10), time: now.slice(11, 16) }
}

export async function readHeld(path: string): Promise<void> {
  const space = workspace.spaces.find((one) => within(one.root, path, one.root) !== null)
  try {
    const base = readBase(await invoke<string>('read_note', { path }))
    if (space && (base.nib.id || readAutomations(base).length)) {
      held.set(path, {
        name: path.replace(/^.*[\\/]/, '').replace(/\.base$/i, ''),
        space: space.name,
        base,
      })
      return
    }
  } catch {
    // A base half written by hand runs nothing until it reads again.
  }
  held.delete(path)
}

function rowsOf(space: string, path: string): readonly Row[] {
  return rows.of(space).filter((row) => row.path === path)
}

function numbering(path: string) {
  const space = workspace.spaces.find((one) => within(one.root, path, one.root) !== null)
  const bases = space ? heldIn(space.name).filter((one) => one.base.nib.id) : []
  return { space, bases }
}

function withoutIds(path: string, text: string): string | null {
  const { space, bases } = numbering(path)
  const relative = space && within(space.root, path, space.root)
  if (!space || !relative || !bases.length) return null
  const row = noteRowsOf(space.name, relative, text).find((one) => one.kind === 'note')
  if (!row) return null
  const context = contextFor({ rows: rows.of(space.name), today: todayHere(), now: nowHere() })
  const gone: Record<string, null> = {}
  for (const one of bases) {
    const id = one.base.nib.id
    if (id && idNumber(row.note[id.property], id.prefix) !== null && inBase(one.base, row, context))
      gone[id.property] = null
  }
  return Object.keys(gone).length ? withProperties(text, gone) : null
}
leaveIdsBy({ numbers: (path) => numbering(path).bases.length > 0, without: withoutIds })

async function run(space: string, path: string, removed: readonly Row[]) {
  const bases = heldIn(space)
  const root = workspace.spaces.find((one) => one.name === space)?.root
  if (!bases.length || root === undefined || !canWriteAt(root)) return
  const all = rows.of(space)
  const today = todayHere()
  const context = contextFor({ rows: all, today, now: nowHere() })
  const plan = planned(bases, removed, rowsOf(space, path), all, context, clock())

  for (const write of plan.writes) ours.add(keyOf(write.row.space, write.row.path))
  if (plan.writes.length && !(await writeEach(plan.writes, true))) {
    for (const write of plan.writes) ours.delete(keyOf(write.row.space, write.row.path))
  }

  for (const move of plan.moves) {
    const said = move.folder.replace(/^\/+|\/+$/g, '')
    const inside = said ? insideOnly(said) : ''
    if (inside === null) continue
    const folder = inside ? insideSpace(root, inside) : root
    await invoke('create_folder', { path: folder }).catch(() => undefined)
    await workspace.move(insideSpace(root, move.row.path), folder).catch(() => undefined)
  }
  for (const notice of plan.notices) {
    show(
      {
        id: `automation:${notice.row.path}`,
        title: notice.base,
        body: notice.words,
        space,
        path: notice.row.path,
        hash: '',
        line: 0,
        at: Date.now(),
      },
      () => {
        void workspace.open(insideSpace(root, notice.row.path))
      },
    )
  }
}

export function heardChange(change: RowsChange) {
  if (change.path === null || !running()) return
  if (!change.added.some((row) => row.kind === 'note')) return
  if (change.from) heard(change.space, change.path, change.from.rows, change.from)
  else {
    const at = insideSpace(change.root, change.path)
    heard(change.space, change.path, change.removed, undefined, landing(at) ? at : undefined)
  }
}

function settling(key: string, space: string, path: string, before: readonly Row[]) {
  waiting.set(key, {
    space,
    path,
    removed: before,
    timer: setTimeout(() => {
      waiting.delete(key)
      void run(space, path, before)
    }, SETTLE),
  })
}

onLanded(() => {
  for (const [key, one] of waiting) {
    if (one.at !== undefined && !landing(one.at)) settling(key, one.space, one.path, one.removed)
  }
})

export function heard(
  space: string,
  path: string,
  removed: readonly Row[],
  from?: { space: string; path: string },
  at?: string,
) {
  const key = keyOf(space, path)
  const left = from && keyOf(from.space, from.path)
  const there = left === undefined ? undefined : waiting.get(left)
  if (left !== undefined && there) {
    clearTimeout(there.timer)
    waiting.delete(left)
  }
  if (ours.delete(key)) return
  const was = waiting.get(key)
  if (was) clearTimeout(was.timer)
  const before = there?.removed ?? (from ? removed : (was?.removed ?? removed))
  if (at === undefined) settling(key, space, path, before)
  else waiting.set(key, { space, path, removed: before, at })
}

export async function repeatTemplates() {
  const space = workspace.activeSpace
  if (!space || !rows.ready || !canWriteAt(space.root)) return
  const folder = joinPath(space.root, await templatesFolder(space.root))
  const today = todayHere()
  for (const row of rows.of(space.name)) {
    if (row.kind !== 'note' || typeof row.note.repeat !== 'string') continue
    const path = insideSpace(space.root, row.path)
    if (within(folder, path, space.root) === null || workspace.documentAt(path)) continue
    const due = repeatDue(row.note, today)
    if (!due) continue

    const said =
      typeof row.note.folder === 'string' ? row.note.folder.trim().replace(/^\/+|\/+$/g, '') : ''
    const inside = said ? insideOnly(said) : ''
    if (inside === null) continue
    const to = inside ? insideSpace(space.root, inside) : space.root
    await invoke('create_folder', { path: to }).catch(() => undefined)
    const title = `${row.file.basename} ${due.day}`
    const name = await workspace.freeNameOnDisk(to, `${title}.md`)
    const words = await templateWords(path, name.replace(/\.md$/i, ''))
    const made = joinPath(to, name)
    await writeFile(made, due.missed.length ? withProperties(words, { missed: due.missed }) : words)
    await workspace.fileCame(made, 'file')

    const template = await workspace.noteText(path)
    if (template !== null) await writeFile(path, withProperties(template, { made: due.day }))
  }
  await workspace.loadTree()
}
