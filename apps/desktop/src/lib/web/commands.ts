/** The desktop app's command surface, served from the browser's own storage.
 *  Same names, same shapes - so every call site works on both. */

import { basename, isMarkdown, join, normalise, parent, safeName, spaceOf, within } from './paths'
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

/** Builds the folder tree from the flat list of paths. */
async function tree(root: string, options: TreeOptions = {}): Promise<Entry> {
  const base = normalise(root)
  const rows = (await files.all()).filter((row) => within(base, row.path))

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

  make(base)

  for (const row of rows) {
    if (basename(row.path) === KEEP) {
      // The marker only exists to keep its folder on the tree.
      make(parent(row.path))
      continue
    }

    if (!isMarkdown(row.path)) continue
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

  sort(folders.get(base)!)
  return folders.get(base)!
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

/** Everything under `from` moves, so renaming a folder takes its notes along. */
async function renameNote(from: string, to: string) {
  const source = normalise(from)
  const target = normalise(to)

  if (await files.get(target)) throw new Error('something already lives there')

  const rows = (await files.all()).filter(
    (row) => row.path === source || row.path.startsWith(`${source}/`),
  )

  if (!rows.length) throw new Error('nothing to rename')

  for (const row of rows) {
    await files.put({ ...row, path: target + row.path.slice(source.length), modified: now() })
    await files.remove(row.path)
  }
}

async function removeFolder(path: string) {
  const base = normalise(path)
  const rows = (await files.all()).filter(
    (row) => row.path === base || row.path.startsWith(`${base}/`),
  )

  for (const row of rows) await files.remove(row.path)
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

async function search(root: string, query: string, limit: number) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const rows = (await files.all())
    .filter((row) => within(normalise(root), row.path) && isMarkdown(row.path))
    .sort((a, b) => (a.path < b.path ? -1 : 1))

  const hits: { path: string; name: string; line: number; text: string }[] = []

  for (const row of rows) {
    row.content.split('\n').forEach((line, index) => {
      if (hits.length >= limit || !line.toLowerCase().includes(needle)) return
      hits.push({
        path: row.path,
        name: basename(row.path),
        line: index,
        text: line.trim().slice(0, 200),
      })
    })

    if (hits.length >= limit) break
  }

  return hits
}

/** Same rule the Rust side uses: a tag starts a word and has no space after the
 *  hash, which is what tells it apart from a heading. */
function tagsIn(body: string): string[] {
  const found: string[] = []
  let fenced = false

  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line.trim())) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    for (const match of line.matchAll(/(^|[\s(])#([\p{L}][\p{L}\p{N}\-_/]*)/gu)) {
      found.push(`#${match[2]}`)
    }
  }

  return found
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

const KEEP_SNAPSHOTS = 40

async function snapshot(path: string, content: string) {
  const notePath = normalise(path)
  await snapshots.put({ notePath, content, taken_at: now(), size: content.length })

  const kept = (await snapshots.forNote(notePath)).sort((a, b) => b.taken_at - a.taken_at)
  for (const old of kept.slice(KEEP_SNAPSHOTS)) {
    if (old.id !== undefined) await snapshots.remove(old.id)
  }
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

export async function webInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
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
      return (await tree(root, (args.options ?? {}) as TreeOptions)) as T

    case 'search_space':
      return (await search(root, args.query as string, (args.limit as number) ?? 100)) as T

    case 'space_tags':
      return (await spaceTags(root)) as T

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
      const folder = join(parent(args.notePath as string), 'assets')

      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)

      const target = join(folder, name)
      await assets.put({
        path: target,
        type: `image/${name.split('.').pop() ?? 'png'}`,
        data: btoa(binary),
        modified: now(),
      })

      return `assets/${name}` as T
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
      const all = await snapshots.forNote(normalise(args.notePath as string) || '')
      const found = all.find((row) => String(row.id) === path)
      return (found?.content ?? '') as T
    }

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
export async function hasContent(): Promise<boolean> {
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
