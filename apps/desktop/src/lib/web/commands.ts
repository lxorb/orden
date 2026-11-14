import {
  toBase64,
  isNumber,
  isRecord,
  isString,
  parsed,
  basename,
  hiddenUnder,
  isCanvas,
  isMarkdown,
  isPages,
  isPdf,
  join,
  normalise,
  parent,
  safeName,
  spaceOf,
  under,
  assetType,
  isReserved,
} from '../platform/src/api'
import { holderOf, paperOf } from '../pages/held'
import { SIDECAR } from '../pdf/highlights'
import { staleSnapshots } from '../recovery'
import { markedPlane, type PlaneMarks, planeMarks } from '@orden/scan/canvas'
import { scanNote, scanShortcut, type SpaceLinks } from '@orden/scan/note'
import { scanRows } from '@orden/bases/scan'
import { tagsIn } from '@orden/scan/search/tags'
import {
  isApplicationTarget,
  isBaseTarget,
  isChatTarget,
  isTermTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { keptAway, NOT_HERE } from './away.svelte'
import { rehomed, unread } from '@orden/scan/indexed'
import {
  assets,
  type FileRow,
  files,
  KEEP,
  keepsOwnRows,
  meta,
  snapshots,
  stats,
  treeAt,
  type TreeRows,
  trees,
} from './store'
import { markSeedSpace, markSeeded, wasSeeded } from '../seeded'
import { breathe } from '../breathe'
import { WELCOME, WELCOME_PATH, WELCOME_SPACE } from '../welcome'

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
  paper?: boolean
  evicted?: boolean
}

interface TreeOptions {
  showHidden?: boolean
  papers?: boolean
  every?: boolean
}

const now = () => Date.now()

export const MOST_NOTE_BYTES = 64 * 1024 * 1024
export const TOO_LARGE = 'that note is too large'

function tooLarge(content: string): boolean {
  if (content.length > MOST_NOTE_BYTES) return true
  if (content.length * 3 <= MOST_NOTE_BYTES) return false
  return new TextEncoder().encode(content).byteLength > MOST_NOTE_BYTES
}

export const SCANNED_AT_ONCE = 256 * 1024

const UNSIZED = SCANNED_AT_ONCE / 128

function chunksOf(
  paths: readonly string[],
  sizes: ReadonlyMap<string, number>,
  wanted: (path: string) => boolean,
): string[][] {
  const out: string[][] = []
  let chunk: string[] = []
  let held = 0

  for (const path of paths) {
    if (!wanted(path)) {
      if (chunk.length && (sizes.get(path) ?? Infinity) > UNSIZED) {
        out.push(chunk)
        chunk = []
        held = 0
      }
      continue
    }

    const size = sizes.get(path) ?? UNSIZED
    if (chunk.length && held + size > SCANNED_AT_ONCE) {
      out.push(chunk)
      chunk = []
      held = 0
    }

    chunk.push(path)
    held += size
  }

  if (chunk.length) out.push(chunk)
  return out
}

function listed(path: string): boolean {
  return (
    isMarkdown(path) ||
    isPdf(path) ||
    isCanvas(path) ||
    isPages(path) ||
    isWebTarget(path) ||
    isBaseTarget(path) ||
    isChatTarget(path) ||
    isTermTarget(path) ||
    isApplicationTarget(path)
  )
}

function sidecarOf(path: string): string {
  return `${normalise(path)}${SIDECAR}`
}

async function tree(root: string, options: TreeOptions = {}, raw = false): Promise<Entry> {
  const base = normalise(root)
  const rows = (await stats.all()).filter((row) => under(base, row.path))
  const away = new Set<string>()
  if (!raw) {
    const here = new Set(rows.map((row) => row.path))
    for (const one of keptAway.under(base)) {
      const path = normalise(one.path)
      if (here.has(path)) continue
      away.add(path)
      rows.push({ path, modified: one.modified, created: one.modified, size: one.size })
    }
  }

  const folders = new Map<string, Entry>()
  const make = (path: string): Entry => {
    const existing = folders.get(path)
    if (existing) return existing

    const entry: Entry = {
      name: basename(path) || 'Orden',
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
  const present = new Set(rows.map((row) => row.path))
  const held = (path: string) => {
    const holder = holderOf(path)
    return holder !== null && present.has(holder)
  }

  for (const row of rows) {
    if (basename(row.path) === KEEP) {
      make(parent(row.path))
      continue
    }

    if (!options.every && !listed(row.path)) continue
    if (!options.showHidden && basename(row.path).startsWith('.')) continue
    if (!options.papers && held(row.path)) continue

    make(parent(row.path)).children.push({
      name: basename(row.path),
      path: row.path,
      is_dir: false,
      modified: row.modified,
      created: row.created,
      children: [],
      ...(present.has(paperOf(row.path)) && isPages(row.path) ? { paper: true } : {}),
      ...(away.has(row.path) ? { evicted: true } : {}),
    })
  }

  const sort = (entry: Entry) => {
    entry.children.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
    })
    entry.children.forEach(sort)
  }

  sort(top)
  return top
}

export function readsAsText(path: string): boolean {
  return (
    isMarkdown(path) ||
    isCanvas(path) ||
    isPages(path) ||
    path.endsWith(SIDECAR) ||
    /\.(base|url|webloc|term|chat|application)$/i.test(path)
  )
}

function wordsOf(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return new TextDecoder().decode(bytes)
}

function base64Of(words: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(words)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function writeBytes(path: string, base64: string, type: string) {
  const at = normalise(path)
  if (!readsAsText(at)) {
    await assets.put({ path: at, type, data: base64, modified: now() })
    return
  }
  if (await assets.get(at)) await assets.remove(at)
  await writeNote(at, wordsOf(base64))
}

async function textRow(path: string): Promise<FileRow | undefined> {
  const at = normalise(path)
  const file = await files.get(at)
  if (!readsAsText(at)) return file
  const asset = await assets.get(at)
  if (!asset) return file

  await assets.remove(at)
  if (file && file.modified >= asset.modified) {
    await files.put(file)
    return file
  }
  await writeNote(at, wordsOf(asset.data))
  return await files.get(at)
}

function baseName(path: string): string {
  return normalise(path).split('/').pop() ?? ''
}

function namedForEveryMachine(path: string): void {
  const name = baseName(path)
  if (isReserved(name)) {
    throw new Error(
      `${name} is a name Windows keeps for a device, so a note or folder cannot be called it`,
    )
  }
}

async function writeNote(path: string, content: string) {
  await files.write(
    normalise(path),
    content,
    now(),
    isCanvas(path) ? planeMarks(content) : undefined,
  )
}

async function renameNote(from: string, to: string, hold = false, alone = false, raw = false) {
  const source = normalise(from)
  const target = normalise(to)
  if (source === target) return

  const tree = treeAt(source, target)
  if (tree) {
    await renameInTree(tree, source, target, hold, alone)
    return
  }

  const turning = hold && isPdf(target) && parent(source) === parent(target)
  const there = await paperInTheWay(source, target)
  if (there && !turning) throw new Error(`${there} is already there`)
  if (!raw && spaceOf(source) !== spaceOf(target) && (await stillAway(source))) {
    throw new Error(NOT_HERE)
  }

  if (await occupied(target, raw)) throw new Error('something already lives there')

  const pictures = await moveAssets(source, target)

  const under = (one: string) => one === source || one.startsWith(`${source}/`)
  const rows = await rowsOf((await files.paths()).filter(under), files.get)

  if (!rows.length && pictures) {
    if (isPdf(source) && !alone) await moveHighlights(source, target)
    return
  }
  if (!rows.length && keptAway.under(source).length) return
  if (!rows.length) throw new Error('nothing to rename')

  await files.move(
    rows.map((row) => ({ ...row, path: target + row.path.slice(source.length), modified: now() })),
    rows.map((row) => row.path),
  )

  if (isPages(source)) await renamePaper(paperOf(source), paperOf(target), !alone)
}

async function stillAway(source: string): Promise<boolean> {
  const away = keptAway.under(source)
  if (!away.length) return false
  const here = new Set(await files.paths())
  return away.some((one) => !here.has(normalise(one.path)))
}

async function renameInTree(
  tree: TreeRows,
  source: string,
  target: string,
  hold: boolean,
  alone: boolean,
) {
  const turning = hold && isPdf(target) && parent(source) === parent(target)
  const there = await paperInTheWay(source, target)
  if (there && !turning) throw new Error(`${there} is already there`)
  if (!(await stats.holds(source))) throw new Error('nothing to rename')

  await tree.move(source, target)

  if (isPdf(source) && !alone) await besideInTree(tree, sidecarOf(source), sidecarOf(target))
  if (isPages(source)) {
    const paper = paperOf(source)
    if (await besideInTree(tree, paper, paperOf(target))) {
      if (!alone) await besideInTree(tree, sidecarOf(paper), sidecarOf(paperOf(target)))
    }
  }
}

async function besideInTree(tree: TreeRows, source: string, target: string): Promise<boolean> {
  if (!(await stats.holds(source)) || (await stats.holds(target))) return false
  await tree.move(source, target)
  return true
}

async function paperInTheWay(source: string, target: string): Promise<string | null> {
  if (isPages(target)) {
    const paper = paperOf(target)
    const own = paperOf(source) === paper
    return (await files.get(source)) && !own && (await assets.get(paper)) ? paper : null
  }
  const holder = holderOf(target)
  return holder && (await files.get(holder)) ? holder : null
}

async function renamePaper(source: string, target: string, highlights = true) {
  const paper = await assets.get(source)
  if (!paper || (await assets.get(target))) return

  await assets.put({ ...paper, path: target, modified: now() })
  await assets.remove(source)
  if (highlights) await moveHighlights(source, target)
}

async function moveHighlights(source: string, target: string) {
  const side = await files.get(sidecarOf(source))
  if (side) await files.move([{ ...side, path: sidecarOf(target), modified: now() }], [side.path])
}

async function bringBackUnder(source: string) {
  if (!(await keptAway.bringBackUnder(source))) throw new Error(NOT_HERE)
}

async function copyPath(from: string, to: string) {
  const source = normalise(from)
  const target = normalise(to)

  if (target === source || target.startsWith(`${source}/`)) {
    throw new Error(`${source} cannot be copied into itself`)
  }
  if ((await occupied(target)) || (await assets.get(target))) {
    throw new Error('something already lives there')
  }
  const there = await paperInTheWay(source, target)
  if (there) throw new Error(`${there} is already there`)

  await bringBackUnder(source)

  const under = (one: string) => one === source || one.startsWith(`${source}/`)
  const copied = (one: string) => target + one.slice(source.length)
  const notes = await rowsOf((await files.paths()).filter(under), files.get)
  const pictures = await rowsOf((await assets.paths()).filter(under), assets.get)
  if (!notes.length && !pictures.length) throw new Error('nothing to copy')

  for (const row of notes) {
    await files.put({ ...row, path: copied(row.path), created: now(), modified: now() })
  }
  for (const row of pictures) await assets.put({ ...row, path: copied(row.path), modified: now() })

  await copyHeld(source, target)
}

async function rowsOf<T>(paths: readonly string[], get: (path: string) => Promise<T | undefined>) {
  const out: T[] = []
  for (const path of paths) {
    const row = await get(path)
    if (row) out.push(row)
  }
  return out
}

async function copyHeld(source: string, target: string) {
  if (isPages(source)) {
    const paper = await assets.get(paperOf(source))
    if (!paper || (await assets.get(paperOf(target)))) return
    await assets.put({ ...paper, path: paperOf(target), modified: now() })
    await copyHeld(paperOf(source), paperOf(target))
    return
  }

  const side = isPdf(source) ? await files.get(sidecarOf(source)) : undefined
  if (side) await files.put({ ...side, path: sidecarOf(target), created: now(), modified: now() })
}

async function removeFolder(path: string) {
  const base = normalise(path)
  const tree = treeAt(base)
  if (tree) {
    await tree.remove(base)
    return
  }
  const under = (one: string) => one === base || one.startsWith(`${base}/`)

  for (const one of (await files.paths()).filter(under)) await files.remove(one)
  for (const one of (await assets.paths()).filter(under)) await assets.remove(one)
}

async function removeEmptyFolder(path: string) {
  const base = normalise(path)
  const inside = (one: string) => one.startsWith(`${base}/`)
  const held = [...(await files.paths()), ...(await assets.paths())].filter(inside)

  if (held.some((one) => basename(one) !== KEEP)) return
  const tree = treeAt(base)
  if (tree) {
    if (await stats.holds(base)) await tree.remove(base)
    return
  }
  for (const one of held) await files.remove(one)
}

async function moveAssets(source: string, target: string): Promise<number> {
  const under = (one: string) => one === source || one.startsWith(`${source}/`)
  const rows = await rowsOf((await assets.paths()).filter(under), assets.get)

  for (const row of rows) {
    await assets.put({ ...row, path: target + row.path.slice(source.length), modified: now() })
    await assets.remove(row.path)
  }
  return rows.length
}

const TRASH = '/.trash'

interface TrashEntry {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
  apart?: boolean
}

let trashCounter = 0

function entryOf(value: unknown): TrashEntry | null {
  if (!isRecord(value)) return null

  const { id, kind, name, from, trashedAt, apart } = value
  if (!isString(id) || !isString(kind) || !isString(name)) return null
  if (!isString(from) || !isNumber(trashedAt)) return null

  return { id, kind, name, from, trashedAt, ...(apart === true ? { apart } : {}) }
}

async function trashEntries(): Promise<TrashEntry[]> {
  const kept = (await Promise.all(trees().map((tree) => tree.trash.list()))).flat()
  return [...(await ownTrash()), ...kept]
}

async function trashOf(id: string): Promise<TreeRows | null> {
  for (const tree of trees()) {
    if ((await tree.trash.list()).some((one) => one.id === id)) return tree
  }
  return null
}

async function ownTrash(): Promise<TrashEntry[]> {
  if (!keepsOwnRows()) return []
  const held = parsed((await meta.get('trash')) ?? null)
  if (!Array.isArray(held)) return []

  return held.map(entryOf).filter((one): one is TrashEntry => one !== null)
}

async function saveTrash(entries: TrashEntry[]) {
  const kept = new Set(
    (await Promise.all(trees().map((tree) => tree.trash.list()))).flat().map((one) => one.id),
  )
  await meta.put('trash', JSON.stringify(entries.filter((one) => !kept.has(one.id))))
}

async function occupied(path: string, raw = false): Promise<boolean> {
  if (await files.get(path)) return true
  if (!raw && keptAway.under(path).length) return true
  return (await files.paths()).some((one) => one.startsWith(`${path}/`))
}

async function holds(path: string): Promise<boolean> {
  if ((await occupied(path)) || (await assets.get(path))) return true
  return (await assets.paths()).some((one) => one.startsWith(`${path}/`))
}

async function freeSpot(path: string, isFile: boolean): Promise<string> {
  return firstSpot(path, isFile, async (one) => !(await taken(one)))
}

async function firstSpot(
  path: string,
  isFile: boolean,
  fits: (one: string) => Promise<boolean>,
): Promise<string> {
  if (await fits(path)) return path

  const folder = parent(path)
  const file = basename(path)
  const dot = file.lastIndexOf('.')
  const stem = isFile && dot > 0 ? file.slice(0, dot) : file
  const extension = isFile && dot > 0 ? file.slice(dot) : ''

  for (let counter = 2; ; counter++) {
    const candidate = join(folder, `${stem} ${counter}${extension}`)
    if (await fits(candidate)) return candidate
  }
}

async function taken(path: string): Promise<boolean> {
  if ((await holds(path)) || (await pairedTaken(path))) return true
  return isPdf(path) && !!(await files.get(sidecarOf(path)))
}

async function pairedTaken(path: string): Promise<boolean> {
  if (/\.pages\.pdf$/i.test(path)) return holds(path.slice(0, -'.pdf'.length))
  if (/\.pages$/i.test(path)) return holds(`${path}.pdf`)
  return false
}

async function trashItem(path: string, kind: string, alone = false): Promise<TrashEntry> {
  const source = normalise(path)
  if (source === '/' || source.startsWith(TRASH)) throw new Error('that cannot be deleted')
  if (!(await holds(source))) throw new Error('nothing is there')

  const id = `${now()}-${trashCounter++}`
  const name = basename(source)
  const tree = treeAt(source)
  if (tree) return trashInTree(tree, source, { id: `internal-${id}`, kind, name, alone })
  await bringBackUnder(source)
  await renameNote(source, `${TRASH}/${id}/${name}`, false, alone)

  const entry = {
    id,
    kind,
    name,
    from: source,
    trashedAt: now(),
    ...(alone ? { apart: true } : {}),
  }
  await saveTrash([...(await trashEntries()), entry])
  return entry
}

async function trashInTree(
  tree: TreeRows,
  source: string,
  item: { id: string; kind: string; name: string; alone: boolean },
): Promise<TrashEntry> {
  const beside: string[] = []
  if (isPdf(source) && !item.alone) beside.push(sidecarOf(source))
  if (isPages(source))
    beside.push(paperOf(source), ...(item.alone ? [] : [sidecarOf(paperOf(source))]))
  const entry = {
    id: item.id,
    kind: item.kind,
    name: item.name,
    trashedAt: now(),
    ...(item.alone ? { apart: true } : {}),
  }
  if (!(await tree.trash.take(source, entry, beside))) throw new Error('nothing is there')
  return { ...entry, from: source }
}

async function trashWords(path: string, content: string): Promise<TrashEntry> {
  const source = normalise(path)
  if (source === '/' || source.startsWith(TRASH)) throw new Error('that cannot be deleted')

  const id = `${now()}-${trashCounter++}`
  const name = basename(source)
  const tree = treeAt(source)
  if (tree) {
    const entry = { id: `internal-${id}`, kind: 'note', name, trashedAt: now() }
    await tree.trash.words(source, content, entry)
    return { ...entry, from: source }
  }
  await writeNote(`${TRASH}/${id}/${name}`, content)

  const entry = { id, kind: 'note', name, from: source, trashedAt: now() }
  await saveTrash([...(await trashEntries()), entry])
  return entry
}

async function restoreTrash(id: string): Promise<string> {
  const entries = await trashEntries()
  const entry = entries.find((one) => one.id === id)
  if (!entry) throw new Error('nothing to restore')

  const tree = await trashOf(id)
  if (tree) {
    const target =
      entry.apart && (await rejoinsHighlights(entry.from))
        ? entry.from
        : await freeSpot(entry.from, entry.kind === 'note')
    await tree.trash.restore(id, target)
    return target
  }

  const held = `${TRASH}/${entry.id}/${entry.name}`
  const rest = entries.filter((one) => one.id !== id)
  if (!(await holds(held))) {
    await saveTrash(rest)
    throw new Error('it is already gone')
  }

  const target =
    entry.apart && (await rejoinsHighlights(entry.from))
      ? entry.from
      : await freeSpot(entry.from, entry.kind === 'note')
  await renameNote(held, target)
  await saveTrash(rest)
  return target
}

async function rejoinsHighlights(pdf: string): Promise<boolean> {
  if (!isPdf(pdf) || (await holds(pdf)) || (await pairedTaken(pdf))) return false
  return !!(await files.get(sidecarOf(pdf)))
}

async function purgeTrash(id: string) {
  const tree = await trashOf(id)
  if (tree) {
    await tree.trash.purge(id)
    return
  }
  await removeFolder(`${TRASH}/${id}`)
  await saveTrash((await trashEntries()).filter((one) => one.id !== id))
}

async function spaceList() {
  const names = new Set<string>()

  const away = keptAway.all().map((one) => normalise(one.path))
  for (const path of [...(await files.paths()), ...away]) {
    const space = spaceOf(path)
    if (space !== '/' && !basename(space).startsWith('.')) names.add(space)
  }

  return [...names]
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .map((path) => ({ name: basename(path), path }))
}

async function spaceTags(root: string) {
  const base = normalise(root)
  const paths = (await files.paths()).filter((path) => under(base, path))
  const sizes = new Map<string, number>()
  for (const row of await stats.all()) {
    if (row.size !== undefined && under(base, row.path)) sizes.set(row.path, row.size)
  }

  const counts = new Map<string, number>()
  for (const chunk of chunksOf(paths, sizes, isMarkdown)) {
    for (const row of await files.between(chunk[0] ?? '', chunk.at(-1) ?? '')) {
      if (!under(base, row.path) || !isMarkdown(row.path)) continue
      for (const tag of tagsIn(row.content)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    await breathe()
  }
  for (const away of keptAway.under(root)) {
    for (const one of keptAway.scanOf(away.id)?.tags ?? []) {
      const tag = one.startsWith('#') ? one : `#${one}`
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
}

async function scanLinks(root: string): Promise<SpaceLinks> {
  const base = normalise(root)
  const relative = (path: string) => path.slice(base === '/' ? 1 : base.length + 1)

  const notes: SpaceLinks['notes'] = []
  const beside: string[] = []
  const paths = (await files.paths()).filter(
    (path) => under(base, path) && !hiddenUnder(base, path),
  )
  const sizes = new Map<string, number>()
  const marked = new Map<string, PlaneMarks>()
  for (const row of await stats.all()) {
    if (!under(base, row.path)) continue
    if (row.size !== undefined) sizes.set(row.path, row.size)
    if (row.plane) marked.set(row.path, row.plane)
  }
  for (const path of paths) {
    if (!sizes.has(path) && (isCanvas(path) || isPages(path))) sizes.set(path, Infinity)
  }

  const read = (path: string) =>
    isMarkdown(path) || isWebTarget(path) || (isCanvas(path) && !marked.has(path))

  for (const path of paths) {
    if (read(path)) continue

    const marks = marked.get(path)
    if (marks) notes.push(markedPlane(relative(path), marks))
    else if (basename(path) !== KEEP && !path.endsWith(SIDECAR)) beside.push(path)
  }

  const learnt: { path: string; modified: number; size: number; plane?: PlaneMarks }[] = []

  for (const chunk of chunksOf(paths, sizes, read)) {
    for (const row of await files.between(chunk[0] ?? '', chunk.at(-1) ?? '')) {
      const found = { path: row.path, modified: row.modified, size: row.content.length }

      if (isCanvas(row.path) && read(row.path)) {
        const marks = planeMarks(row.content)
        notes.push(markedPlane(relative(row.path), marks))
        learnt.push({ ...found, plane: marks })
        continue
      }

      if (!sizes.has(row.path)) learnt.push(found)
      if (!read(row.path)) continue

      if (isMarkdown(row.path)) {
        notes.push({
          ...scanNote(relative(row.path), row.content),
          ...scanRows(row.content),
          stamp: { size: row.content.length, mtime: row.modified, ctime: row.created },
        })
        continue
      }

      notes.push(scanShortcut(relative(row.path), row.content))
      beside.push(row.path)
    }

    await breathe()
  }

  if (learnt.length) await stats.learn(learnt).catch(() => undefined)

  const here = new Set(paths)
  for (const away of keptAway.under(base)) {
    const path = normalise(away.path)
    if (here.has(path) || hiddenUnder(base, path)) continue
    const at = relative(path)
    const stamp = { size: away.size, mtime: away.modified, ctime: away.modified }
    const said = keptAway.scanOf(away.id)
    const scan = said ? rehomed(said, at) : unread(at, stamp)
    if (scan) notes.push(scan)
    if (!scan || isWebTarget(path)) beside.push(path)
  }

  const pictures = (await assets.paths()).filter(
    (path) => under(base, path) && !hiddenUnder(base, path),
  )

  return {
    notes: notes.sort((a, b) => (a.path < b.path ? -1 : 1)),
    files: [...beside, ...pictures].map(relative).sort(),
  }
}

const KEEP_SNAPSHOTS = 40

async function snapshot(path: string, content: string, source: string | undefined) {
  const notePath = normalise(path)
  const said = source ? { source: source.trim().slice(0, 64) } : {}
  const last = await snapshots.newest(notePath)
  if (last?.content === content) {
    if (source) await snapshots.put({ ...last, ...said })
    return
  }

  await snapshots.put({ notePath, content, taken_at: now(), size: content.length, ...said })

  const ids = await snapshots.idsOf(notePath)
  for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_SNAPSHOTS))) {
    await snapshots.remove(id)
  }
}

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

const THEMES = 'themes/'

const THEME_ID = /^[a-z0-9][a-z0-9-]{0,38}$/

const themeKey = (id: string) => `${THEMES}${id}.css`

function humanise(stem: string): string {
  const spaced = stem.replace(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

async function listThemes(): Promise<{ id: string; name: string; path: string }[]> {
  const keys = (await meta.keys()).filter(
    (key): key is string => typeof key === 'string' && key.startsWith(THEMES),
  )

  return keys
    .map((key) => {
      const stem = key.slice(THEMES.length).replace(/\.css$/, '')
      return { id: `file:${stem}`, name: humanise(stem), path: key }
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

async function writeTheme(id: string, css: string): Promise<string> {
  if (!THEME_ID.test(id)) throw new Error(`${id} is not a theme id`)

  const key = themeKey(id)
  await meta.put(key, css)
  return key
}

async function removeTheme(id: string): Promise<void> {
  if (!THEME_ID.test(id)) throw new Error(`${id} is not a theme id`)
  await meta.remove(themeKey(id))
}

const PAPERS = 'papers/'

const PAPER_LIMIT = 4 * 1024 * 1024

const paperKey = (path: string, size: number) => `${PAPERS}${size}:${path}`

async function paperRecords(): Promise<{ key: string; path: string; size: number }[]> {
  const keys = (await meta.keys()).filter(
    (key): key is string => typeof key === 'string' && key.startsWith(PAPERS),
  )

  return keys.flatMap((key) => {
    const rest = key.slice(PAPERS.length)
    const at = rest.indexOf(':')
    const size = Number(rest.slice(0, at))
    const path = rest.slice(at + 1)
    if (at < 1 || !Number.isFinite(size) || !path) return []

    return [{ key, path, size }]
  })
}

async function readPaperText(path: string): Promise<string> {
  const wanted = normalise(path)
  const found = (await paperRecords()).find((one) => one.path === wanted)

  return found ? ((await meta.get(found.key)) ?? '') : ''
}

async function writePaperText(path: string, content: string): Promise<void> {
  if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
  if (content.length > PAPER_LIMIT) throw new Error(`${path} would keep too much`)

  const wanted = normalise(path)
  for (const one of await paperRecords()) {
    if (one.path === wanted) await meta.remove(one.key)
  }

  if (content) await meta.put(paperKey(wanted, content.length), content)
}

const SCRATCHPAD = '/.orden/Scratchpad.md'
const FORMER_SCRATCHPAD = '/.nib/Scratchpad.md'

const UNSUPPORTED: Record<string, unknown> = {
  has_pandoc: false,
  web_pass_fill: false,
  file_stamp: null,
  mcp_config: null,
  owner_can: false,
  write_log: null,
  read_log: '',
  log_dir: '',
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
      let row = await textRow(path)
      if (!row && args.raw !== true && keptAway.at(path)) {
        if (!(await keptAway.bringBack(path))) throw new Error(NOT_HERE)
        row = await textRow(path)
      }
      if (!row) throw new Error('no such note')
      if (tooLarge(row.content)) throw new Error(TOO_LARGE)
      return row.content as T
    }

    case 'write_note':
      if (args.arrived !== true && args.raw !== true && keptAway.at(path)) {
        if (!(await keptAway.bringBack(path))) throw new Error(NOT_HERE)
      }
      if (args.arrived !== true && !(await occupied(normalise(path)))) namedForEveryMachine(path)
      await writeNote(path, args.content as string)
      return undefined as T

    case 'write_bytes':
      await writeBytes(
        path,
        args.bytes instanceof Uint8Array ? toBase64(args.bytes) : (args.base64 as string),
        assetType(path),
      )
      return undefined as T

    case 'delete_note':
      await files.remove(normalise(path))
      await assets.remove(normalise(path))
      if (isPdf(path)) await files.remove(sidecarOf(path))
      if (isPages(path)) {
        await assets.remove(paperOf(normalise(path)))
        await files.remove(sidecarOf(paperOf(path)))
      }
      return undefined as T

    case 'rename_note':
      if (args.arrived !== true && baseName(args.from as string) !== baseName(args.to as string)) {
        namedForEveryMachine(args.to as string)
      }
      await renameNote(
        args.from as string,
        args.to as string,
        args.hold === true,
        args.alone === true,
        args.raw === true,
      )
      return undefined as T

    case 'copy_path':
      namedForEveryMachine(args.to as string)
      await copyPath(args.from as string, args.to as string)
      return undefined as T

    case 'create_folder':
      if (args.arrived !== true) namedForEveryMachine(path)
      await writeNote(join(path, KEEP), '')
      return undefined as T

    case 'delete_folder':
      await removeFolder(path)
      return undefined as T

    case 'remove_empty_folder':
      await removeEmptyFolder(path)
      return undefined as T

    case 'read_tree':
      return (await tree(root, args.options ?? {}, args.raw === true)) as T

    case 'path_exists':
      if (args.raw !== true && keptAway.under(path).length) return true as T
      return (await stats.holds(normalise(path))) as T

    case 'let_go_note':
      await files.remove(normalise(path))
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
      const from = normalise(args.from as string)
      if (from !== target) {
        await renameNote(args.from as string, target)
        const entries = await trashEntries()
        const gone = entries
          .filter((one) => one.kind === 'space' && one.from === from)
          .map((one) => one.trashedAt)
          .reduce((high, one) => Math.max(high, one), -Infinity)
        const follows = (one: TrashEntry) => one.from.startsWith(`${from}/`) && one.trashedAt > gone
        if (entries.some(follows)) {
          await saveTrash(
            entries.map((one) =>
              follows(one) ? { ...one, from: `${target}${one.from.slice(from.length)}` } : one,
            ),
          )
        }
      }
      return { name: wanted, path: target } as T
    }

    case 'delete_space':
      await removeFolder(path)
      return undefined as T

    case 'trash_item':
      return (await trashItem(path, args.kind as string, args.alone === true)) as T

    case 'trash_words':
      return (await trashWords(path, args.content as string)) as T

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
      const given = ((args.name as string) || `pasted-${now()}.png`).replace(/[/\\]/g, '-')
      const name = isReserved(given) ? `_${given}` : given
      const notePath = args.notePath as string
      const relative = ((args.folder as string | undefined) ?? 'assets').replace(/^\/+|\/+$/g, '')

      const folder = join(parent(notePath), relative)
      const space = spaceOf(notePath)
      if (folder !== space && !under(space, folder)) {
        throw new Error(`${relative} is not a folder inside the space`)
      }

      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)

      const data = btoa(binary)
      const same = async (one: string) =>
        (await assets.get(one))?.data === data && !(isPdf(one) && (await pairedTaken(one)))
      const target = await firstSpot(
        join(folder, name),
        true,
        async (one) => !(await taken(one)) || (await same(one)),
      )
      const file = basename(target)
      if (await same(target)) return (relative ? `${relative}/${file}` : file) as T

      await writeBytes(target, data, assetType(file))

      return (relative ? `${relative}/${file}` : file) as T
    }

    case 'read_highlights': {
      if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
      return ((await textRow(sidecarOf(path)))?.content ?? '') as T
    }

    case 'write_highlights': {
      if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
      const content = args.content as string
      if (content) await writeNote(sidecarOf(path), content)
      else await files.remove(sidecarOf(path))
      return undefined as T
    }

    case 'read_paper_text':
      return (await readPaperText(path)) as T

    case 'write_paper_text': {
      await writePaperText(path, args.content as string)
      return undefined as T
    }

    case 'list_paper_texts':
      return (await paperRecords()).map(({ path: at, size }) => ({ path: at, size })) as T

    case 'read_asset': {
      const words = readsAsText(path) ? await textRow(path) : undefined
      if (words) return `data:${assetType(path)};base64,${base64Of(words.content)}` as T
      const row = await assets.get(normalise(path))
      if (!row) throw new Error('no such image')
      return `data:${assetType(path, row.type)};base64,${row.data}` as T
    }

    case 'snapshot_note':
      await snapshot(
        path,
        args.content as string,
        typeof args.source === 'string' ? args.source : undefined,
      )
      return undefined as T

    case 'list_snapshots': {
      const kept = await snapshots.forNote(normalise(path))
      return kept
        .sort((a, b) => b.taken_at - a.taken_at)
        .map((row) => ({
          path: String(row.id),
          taken_at: row.taken_at,
          size: row.size,
          ...(row.source ? { source: row.source } : {}),
        })) as T
    }

    case 'read_snapshot': {
      const id = Number(path)
      const found = Number.isInteger(id) ? await snapshots.get(id) : undefined
      return (found?.content ?? '') as T
    }

    case 'purge_snapshots':
      return (await purgeSnapshots(args.days as number)) as T

    case 'list_themes':
      return (await listThemes()) as T

    case 'read_theme':
      return ((await meta.get(path)) ?? '') as T

    case 'write_theme':
      return (await writeTheme(args.id as string, args.css as string)) as T

    case 'remove_theme':
      await removeTheme(args.id as string)
      return undefined as T

    case 'read_custom_css':
      return ((await meta.get('custom.css')) ?? '') as T

    case 'read_snippets':
      return ((await meta.get('snippets.json')) ?? '{}') as T

    case 'scratchpad_path': {
      if (!(await files.get(SCRATCHPAD))) {
        const kept = await textRow(FORMER_SCRATCHPAD)
        await writeNote(SCRATCHPAD, kept?.content ?? '')
      }
      return SCRATCHPAD as T
    }

    case 'new_window':
      window.open(location.href, '_blank')
      return undefined as T

    case 'show_window':
      window.focus()
      return undefined as T

    case 'secret_read':
      return ((await meta.get(secretKey(args.name as string))) ?? null) as T

    case 'secret_write':
      await meta.put(secretKey(args.name as string), args.secret as string)
      return undefined as T

    case 'secret_forget':
      await meta.remove(secretKey(args.name as string))
      return undefined as T

    default:
      if (command in UNSUPPORTED) return UNSUPPORTED[command] as T
      throw new Error(`${command} is not available in the browser`)
  }
}

function secretKey(name: string): string {
  return `ai-key/${name}`
}

async function hasContent(): Promise<boolean> {
  return (await files.paths()).length > 0
}

export async function seed(): Promise<boolean> {
  if (await wasSeeded()) return false

  if (await hasContent()) {
    await markSeeded()
    return false
  }

  await writeNote(WELCOME_PATH, WELCOME)
  await markSeeded()
  markSeedSpace(`/${WELCOME_SPACE}`)
  return true
}
