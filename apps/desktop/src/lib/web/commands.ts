/** The desktop app's command surface, served from the browser's own storage.
 *  Same names, same shapes - so every call site works on both. */

import { SIDECAR } from '../pdf/highlights'
import { staleSnapshots } from '../recovery'
import { scanNote, type SpaceLinks } from '../scan-note'
import { type Hit, Matcher } from '../search/match'
import type { Query } from '../search/query'
import { tagsIn } from '../search/tags'
import {
  basename,
  isMarkdown,
  isPdf,
  join,
  normalise,
  parent,
  safeName,
  spaceOf,
  within,
} from './paths'
import { assets, files, KEEP, meta, snapshots } from './store'

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

interface TreeOptions {
  showHidden?: boolean
  sort?: string
  descending?: boolean
}

const now = () => Date.now()

/** Whether a file is one the tree shows: a note, or a PDF beside one. The same
 *  two kinds the desktop's `read_tree` lists, and for the same reason - they are
 *  the two things a tab can hold. */
function listed(path: string): boolean {
  return isMarkdown(path) || isPdf(path)
}

/** Where a PDF's highlights are kept. The desktop's command derives this on the
 *  Rust side; here the store is a flat map of paths, so it is derived in front of
 *  it. */
function sidecarOf(path: string): string {
  return `${normalise(path)}${SIDECAR}`
}

/** Builds the folder tree from the flat list of paths. */
async function tree(root: string, options: TreeOptions = {}): Promise<Entry> {
  const base = normalise(root)
  // The notes live in one store and everything else in another, and the tree
  // shows both kinds a tab can hold; see `listed` below.
  const rows = [
    ...(await files.all()).filter((row) => within(base, row.path)),
    ...(await assets.all())
      .filter((row) => within(base, row.path))
      .map((row) => ({ path: row.path, modified: row.modified, created: row.modified })),
  ]

  const folders = new Map<string, Entry>()
  const make = (path: string): Entry => {
    const existing = folders.get(path)
    if (existing) return existing

    const entry: Entry = {
      name: basename(path) || 'Nib',
      path,
      is_dir: true,
      modified: 0,
      created: 0,
      children: [],
    }

    folders.set(path, entry)
    if (path !== base) make(parent(path)).children.push(entry)
    return entry
  }

  const top = make(base)

  for (const row of rows) {
    if (basename(row.path) === KEEP) {
      // The marker only exists to keep its folder on the tree.
      make(parent(row.path))
      continue
    }

    if (!listed(row.path)) continue
    if (!options.showHidden && basename(row.path).startsWith('.')) continue

    make(parent(row.path)).children.push({
      name: basename(row.path),
      path: row.path,
      is_dir: false,
      modified: row.modified,
      created: row.created,
      children: [],
    })
  }

  const key = options.sort ?? 'name'
  const order = (a: Entry, b: Entry) => {
    if (key === 'modified') return a.modified - b.modified
    if (key === 'created') return a.created - b.created
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
  }

  const sort = (entry: Entry) => {
    entry.children.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      return options.descending ? -order(a, b) : order(a, b)
    })
    entry.children.forEach(sort)
  }

  sort(top)
  return top
}

async function writeNote(path: string, content: string) {
  const target = normalise(path)
  const existing = await files.get(target)

  await files.put({
    path: target,
    content,
    created: existing?.created ?? now(),
    modified: now(),
  })
}

/** Everything under `from` moves, so renaming a folder takes its notes along -
 *  and the files beside them, which is how a PDF's own highlights follow it. */
async function renameNote(from: string, to: string) {
  const source = normalise(from)
  const target = normalise(to)
  if (source === target) return

  await moveAssets(source, target)

  // `occupied` and not `files.get`: a folder has no row of its own, so asking
  // only about an exact path would let a note be renamed onto a folder and
  // land inside it, taking the folder's name and hiding what was in it.
  if (await occupied(target)) throw new Error('something already lives there')

  const rows = (await files.all()).filter(
    (row) => row.path === source || row.path.startsWith(`${source}/`),
  )

  if (!rows.length) throw new Error('nothing to rename')

  // One transaction for the lot. Row by row, a browser closed halfway through
  // renaming a folder would leave half its notes under the old name and half
  // under the new, with no way to tell which.
  await files.move(
    rows.map((row) => ({ ...row, path: target + row.path.slice(source.length), modified: now() })),
    rows.map((row) => row.path),
  )
}

async function removeFolder(path: string) {
  const base = normalise(path)
  const under = (row: { path: string }) => row.path === base || row.path.startsWith(`${base}/`)

  for (const row of (await files.all()).filter(under)) await files.remove(row.path)
  for (const row of (await assets.all()).filter(under)) await assets.remove(row.path)
}

/** The files beside the notes, moved with them. A PDF is a row in the asset store
 *  rather than in the note store, so a rename that only walked the notes would
 *  leave the paper behind under a folder that no longer exists. */
async function moveAssets(source: string, target: string) {
  const rows = (await assets.all()).filter(
    (row) => row.path === source || row.path.startsWith(`${source}/`),
  )

  for (const row of rows) {
    await assets.put({ ...row, path: target + row.path.slice(source.length), modified: now() })
    await assets.remove(row.path)
  }
}

/** Recently deleted, the browser's way: rows move under `/.trash/<id>/` and a
 *  manifest in the meta store says what each was and where it came from.
 *  The same commands as the desktop's trash.rs, so the app never branches. */
const TRASH = '/.trash'

interface TrashEntry {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
}

let trashCounter = 0

async function trashEntries(): Promise<TrashEntry[]> {
  const raw = await meta.get('trash')
  return raw ? (JSON.parse(raw) as TrashEntry[]) : []
}

async function saveTrash(entries: TrashEntry[]) {
  await meta.put('trash', JSON.stringify(entries))
}

async function occupied(path: string): Promise<boolean> {
  if (await files.get(path)) return true
  return (await files.all()).some((row) => row.path.startsWith(`${path}/`))
}

/** `path` if nothing is there, else `name 2`, `name 3`... - before the
 *  extension for a note, after the name for a folder or a space. */
async function freeSpot(path: string, isFile: boolean): Promise<string> {
  if (!(await occupied(path))) return path

  const folder = parent(path)
  const file = basename(path)
  const dot = file.lastIndexOf('.')
  const stem = isFile && dot > 0 ? file.slice(0, dot) : file
  const extension = isFile && dot > 0 ? file.slice(dot) : ''

  for (let counter = 2; ; counter++) {
    const candidate = join(folder, `${stem} ${counter}${extension}`)
    if (!(await occupied(candidate))) return candidate
  }
}

async function trashItem(path: string, kind: string): Promise<TrashEntry> {
  const source = normalise(path)
  if (source === '/' || source.startsWith(TRASH)) throw new Error('that cannot be deleted')
  if (!(await occupied(source))) throw new Error('nothing is there')

  const id = `${now()}-${trashCounter++}`
  const name = basename(source)
  await renameNote(source, `${TRASH}/${id}/${name}`)

  const entry = { id, kind, name, from: source, trashedAt: now() }
  await saveTrash([...(await trashEntries()), entry])
  return entry
}

async function restoreTrash(id: string): Promise<string> {
  const entries = await trashEntries()
  const entry = entries.find((one) => one.id === id)
  if (!entry) throw new Error('nothing to restore')

  const held = `${TRASH}/${entry.id}/${entry.name}`
  const rest = entries.filter((one) => one.id !== id)
  if (!(await occupied(held))) {
    await saveTrash(rest)
    throw new Error('it is already gone')
  }

  const target = await freeSpot(entry.from, entry.kind === 'note')
  await renameNote(held, target)
  await saveTrash(rest)
  return target
}

async function purgeTrash(id: string) {
  await removeFolder(`${TRASH}/${id}`)
  await saveTrash((await trashEntries()).filter((one) => one.id !== id))
}

async function spaceList() {
  const rows = await files.all()
  const names = new Set<string>()

  for (const row of rows) {
    const space = spaceOf(row.path)
    // A dot folder is the app's own, not a space: Recently deleted lives in one.
    if (space !== '/' && !basename(space).startsWith('.')) names.add(space)
  }

  return [...names]
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .map((path) => ({ name: basename(path), path }))
}

/** How many hits are worth handing over at once. The same handful the Rust
 *  side sends, so a list fills the same way on both. */
const BATCH = 24

/** The same search the desktop runs, over the rows in this browser. The query
 *  arrives already parsed and the matching itself is shared code, so the two
 *  cannot answer differently; what differs is only where the notes are. */
async function search(root: string, query: Query, limit: number, onHits: (hits: Hit[]) => void) {
  const base = normalise(root)
  const matcher = new Matcher(query)
  let found = 0
  let pending: Hit[] = []

  // A cursor rather than the whole store: the rows come in path order, which
  // is the order the desktop walks a space in, and the first rows are on
  // screen while the last folder is still being read.
  await files.each((row) => {
    if (found >= limit) return
    if (!within(base, row.path) || !isMarkdown(row.path)) return

    const hits = matcher.hits(
      {
        path: row.path,
        relative: row.path.slice(base === '/' ? 1 : base.length + 1),
        name: basename(row.path),
        body: row.content,
      },
      limit - found,
    )
    if (!hits.length) return

    found += hits.length
    pending.push(...hits)

    if (pending.length >= BATCH) {
      onHits(pending)
      pending = []
    }
  })

  if (pending.length) onHits(pending)
}

async function spaceTags(root: string) {
  const rows = (await files.all()).filter(
    (row) => within(normalise(root), row.path) && isMarkdown(row.path),
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of tagsIn(row.content)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
}

/** The browser's answer to the desktop's `scan_links`, which reads a whole space
 *  in one pass. Here the space is already in memory, so the pass is over rows
 *  rather than over files; each note is read by `scanNote`, which is also what
 *  the index uses for a note that has just been saved. */
async function scanLinks(root: string): Promise<SpaceLinks> {
  const base = normalise(root)
  const rows = (await files.all()).filter((row) => within(base, row.path))
  const relative = (path: string) => path.slice(base === '/' ? 1 : base.length + 1)

  const notes = rows
    .filter((row) => isMarkdown(row.path))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((row) => scanNote(relative(row.path), row.content))

  // Pictures live in their own store here, and a `.keep` is scaffolding rather
  // than a file somebody put in the space.
  const kept = rows.filter(
    (row) => !isMarkdown(row.path) && basename(row.path) !== KEEP && !row.path.endsWith(SIDECAR),
  )
  const pictures = (await assets.all()).filter((row) => within(base, row.path))

  return {
    notes,
    files: [...kept, ...pictures].map((row) => relative(row.path)).sort(),
  }
}

const KEEP_SNAPSHOTS = 40

async function snapshot(path: string, content: string) {
  const notePath = normalise(path)
  const kept = (await snapshots.forNote(notePath)).sort((a, b) => b.taken_at - a.taken_at)
  // Nothing to keep when the words have not moved since the last version, which
  // is what the disk side does too; see src-tauri/src/history.rs.
  if (kept[0]?.content === content) return

  await snapshots.put({ notePath, content, taken_at: now(), size: content.length })

  for (const old of kept.slice(KEEP_SNAPSHOTS - 1)) {
    if (old.id !== undefined) await snapshots.remove(old.id)
  }
}

/** The retention sweep, by the same policy the desktop sweeps by: see
 *  recovery.ts, which both sides read it from. */
async function purgeSnapshots(days: number): Promise<number> {
  const all = await snapshots.all()
  const byNote = new Map<string, { id?: number; taken_at: number }[]>()
  for (const row of all) {
    const note = byNote.get(row.notePath) ?? []
    note.push(row)
    byNote.set(row.notePath, note)
  }

  let dropped = 0
  for (const rows of byNote.values()) {
    const stale = new Set(
      staleSnapshots(
        rows.map((row) => row.taken_at),
        now(),
        days,
      ),
    )

    for (const row of rows) {
      if (row.id === undefined || !stale.has(row.taken_at)) continue

      await snapshots.remove(row.id)
      dropped++
    }
  }

  return dropped
}

/** Commands the browser genuinely cannot serve. Each returns the shape that
 *  makes the interface hide the feature rather than break on it. */
const UNSUPPORTED: Record<string, unknown> = {
  has_pandoc: false,
  take_startup_files: [],
  mcp_config: null,
  new_menu_registered: false,
  remember_recent: null,
  write_log: null,
  read_log: '',
  log_dir: '',
  list_themes: [],
  theme_dir: '',
  custom_css_path: '/custom.css',
  snippets_path: '/snippets.json',
}

export async function webInvoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const path = args.path as string
  const root = args.root as string

  switch (command) {
    case 'read_note': {
      const row = await files.get(normalise(path))
      if (!row) throw new Error('no such note')
      return row.content as T
    }

    case 'write_note':
      await writeNote(path, args.content as string)
      return undefined as T

    case 'delete_note':
      await files.remove(normalise(path))
      await assets.remove(normalise(path))
      // A PDF's highlights are part of it and have nothing left to describe.
      if (isPdf(path)) await files.remove(sidecarOf(path))
      return undefined as T

    case 'rename_note':
      await renameNote(args.from as string, args.to as string)
      return undefined as T

    case 'create_folder':
      // A folder is only real once it holds something.
      await writeNote(join(path, KEEP), '')
      return undefined as T

    case 'delete_folder':
      await removeFolder(path)
      return undefined as T

    case 'read_tree':
      return (await tree(root, args.options ?? {})) as T

    case 'search_space':
      await search(
        root,
        args.query as Query,
        (args.limit as number | undefined) ?? 100,
        args.hits as (hits: Hit[]) => void,
      )
      return undefined as T

    case 'space_tags':
      return (await spaceTags(root)) as T

    case 'scan_links':
      return (await scanLinks(root)) as T

    case 'spaces_root':
      return '/' as T

    case 'list_spaces':
      return (await spaceList()) as T

    case 'create_space': {
      const wanted = safeName(args.name as string)
      if (!wanted) throw new Error('that name cannot be used')

      const taken = new Set((await spaceList()).map((space) => space.name))
      let name = wanted
      let counter = 2
      while (taken.has(name)) name = `${wanted} ${counter++}`

      await writeNote(join('/', `${name}/${KEEP}`), '')
      return { name, path: `/${name}` } as T
    }

    case 'rename_space': {
      const wanted = safeName(args.name as string)
      if (!wanted) throw new Error('that name cannot be used')

      const target = `/${wanted}`
      if (normalise(args.from as string) !== target) {
        await renameNote(args.from as string, target)
      }
      return { name: wanted, path: target } as T
    }

    case 'delete_space':
      await removeFolder(path)
      return undefined as T

    case 'trash_item':
      return (await trashItem(path, args.kind as string)) as T

    case 'list_trash':
      return (await trashEntries()).sort((a, b) => b.trashedAt - a.trashedAt) as T

    case 'restore_trash':
      return (await restoreTrash(args.id as string)) as T

    case 'purge_trash':
      await purgeTrash(args.id as string)
      return undefined as T

    case 'purge_trash_older_than': {
      const cutoff = now() - (args.age as number)
      const old = (await trashEntries()).filter((one) => one.trashedAt < cutoff)
      for (const one of old) await purgeTrash(one.id)
      return old.length as T
    }

    case 'save_asset': {
      const bytes = args.bytes as number[]
      const name = (args.name as string) || `pasted-${now()}.png`
      const notePath = args.notePath as string
      // Relative to the note's own folder, as the desktop command takes it; see
      // attachments.ts for which of the three it is.
      const relative = ((args.folder as string | undefined) ?? 'assets').replace(/^\/+|\/+$/g, '')

      const folder = join(parent(notePath), relative)
      // The same limit the desktop command holds a folder to: a picture of this
      // note goes somewhere in this note's space and nowhere else.
      const space = spaceOf(notePath)
      if (folder !== space && !within(space, folder)) {
        throw new Error(`${relative} is not a folder inside the space`)
      }

      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)

      await assets.put({
        path: join(folder, name),
        type: `image/${name.split('.').pop() ?? 'png'}`,
        data: btoa(binary),
        modified: now(),
      })

      return (relative ? `${relative}/${name}` : name) as T
    }

    case 'read_highlights': {
      if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
      return ((await files.get(sidecarOf(path)))?.content ?? '') as T
    }

    case 'write_highlights': {
      if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
      const content = args.content as string
      if (content) await writeNote(sidecarOf(path), content)
      else await files.remove(sidecarOf(path))
      return undefined as T
    }

    case 'read_asset': {
      const row = await assets.get(normalise(path))
      if (!row) throw new Error('no such image')
      return `data:${row.type};base64,${row.data}` as T
    }

    case 'snapshot_note':
      await snapshot(path, args.content as string)
      return undefined as T

    case 'list_snapshots': {
      const kept = await snapshots.forNote(normalise(path))
      return kept
        .sort((a, b) => b.taken_at - a.taken_at)
        .map((row) => ({ path: String(row.id), taken_at: row.taken_at, size: row.size })) as T
    }

    case 'read_snapshot': {
      // Every note's versions rather than one note's: the row is asked for by
      // the id the listing gave out, and the caller has no reason to say which
      // note it belongs to twice.
      const found = (await snapshots.all()).find((row) => String(row.id) === path)
      return (found?.content ?? '') as T
    }

    case 'purge_snapshots':
      return (await purgeSnapshots(args.days as number)) as T

    case 'read_custom_css':
      return ((await meta.get('custom.css')) ?? '') as T

    case 'read_snippets':
      return ((await meta.get('snippets.json')) ?? '{}') as T

    case 'new_window':
      window.open(location.href, '_blank')
      return undefined as T

    default:
      if (command in UNSUPPORTED) return UNSUPPORTED[command] as T
      throw new Error(`${command} is not available in the browser`)
  }
}

/** True once anything has been written, so a first visit can be seeded. */
async function hasContent(): Promise<boolean> {
  return (await files.all()).length > 0
}

export async function seed() {
  if (await hasContent()) return

  await writeNote('/Notes/Read me.md', WELCOME)
}

const WELCOME = `# Welcome to Nib

This is the browser version. Your notes live in this browser until you sign in
and turn on syncing, and then they follow you everywhere.

- Everything is markdown, and nothing else
- **Bold**, *italic*, ==highlight==, \`code\`
- $E = mc^2$ renders as you type

\`\`\`js
const hello = 'world'
\`\`\`

| What | Where |
| ---- | ----- |
| Notes | this browser |
| Synced notes | your account |
`
