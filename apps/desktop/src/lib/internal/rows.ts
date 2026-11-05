/** A space Orden keeps itself (internal/folder.ts), as the rows the browser build's commands
 *  read and write (web/store.ts): mounted at the space's address, it answers every
 *  command a folder of the browser's answers, so the commands are the same code on
 *  both (#1068, step 4c).
 *
 *  Words are `files`, every other file `assets`, split the way the commands split them
 *  (`readsAsText`), so a path is in one table or the other and never both. A folder is
 *  what the browser makes one, a `.keep` under it, and writing one is making the folder.
 *  A move and a delete of a path with everything under it, and the trash, are the
 *  folder's own steps (`tree`), so a rename is one line of the index and no file under
 *  it changes its identity. */

import { fromBase64, toBase64 } from '../bytes'
import type { PlaneMarks } from '../scan-canvas'
import { assetType } from '../web/asset-route'
import { basename, normalise, parent } from '../web/paths'
import { type AssetRow, type FileRow, KEEP, type Rows, type Trashed } from '../web/store'
import type { InternalEntry, InternalFolder } from './folder'

/** `folder` as rows at `root`, an address of the browser build's shape (`/<name>`).
 *  `words` says which files are read as words; see `readsAsText` in web/commands.ts. */
export function internalRows(
  folder: InternalFolder,
  root: string,
  words: (path: string) => boolean,
): Rows {
  const base = normalise(root)
  /** Where a path is in the space, `''` its top. */
  const inSpace = (path: string): string => {
    const at = normalise(path)
    if (at === base) return ''
    if (!at.startsWith(`${base}/`)) throw new Error(`${path} is not in ${root}`)
    return at.slice(base.length + 1)
  }
  const address = (path: string) => (path ? `${base}/${path}` : base)
  const isKeep = (path: string) => basename(path) === KEEP
  /** What a plane's listing carries, learnt by the scan and written with the plane. */
  const planes = new Map<string, PlaneMarks>()

  const fileRow = async (path: string, entry: InternalEntry): Promise<FileRow | undefined> => {
    if (!entry.key) return undefined
    const content = await folder.bytes.readText(entry.key)
    if (content === null) return undefined
    return { path, content, modified: entry.modified, created: entry.made }
  }

  const keepRow = (path: string, entry: InternalEntry): FileRow => ({
    path: `${path}/${KEEP}`,
    content: '',
    modified: entry.modified,
    created: entry.made,
  })

  /** Every path's row of the listing, a folder as its `.keep`, in path order. */
  const listing = async () => {
    const out: { path: string; entry: InternalEntry }[] = []
    for (const { path, entry } of await folder.list()) {
      out.push({ path: entry.key ? address(path) : `${address(path)}/${KEEP}`, entry })
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** The rows of words, folders' `.keep` among them, in path order. */
  const wordRows = async (wanted: (path: string) => boolean = () => true) => {
    const out: FileRow[] = []
    for (const { path, entry } of await listing()) {
      if (!wanted(path)) continue
      if (!entry.key) out.push({ path, content: '', modified: entry.modified, created: entry.made })
      else if (words(path)) {
        const row = await fileRow(path, entry)
        if (row) out.push(row)
      }
    }
    return out
  }

  const assetRows = async () => {
    const out: AssetRow[] = []
    for (const { path, entry } of await listing()) {
      if (!entry.key || words(path)) continue
      const row = await asset(path, entry)
      if (row) out.push(row)
    }
    return out
  }

  const asset = async (path: string, entry: InternalEntry): Promise<AssetRow | undefined> => {
    if (!entry.key) return undefined
    const bytes = await folder.bytes.read(entry.key)
    if (!bytes) return undefined
    return { path, type: assetType(path), data: toBase64(bytes), modified: entry.modified }
  }

  /** A folder's `.keep` taken away: the folder goes if nothing at all is in it, as a
   *  folder of the browser's would. */
  const unkeep = async (path: string) => {
    const at = inSpace(parent(path))
    const entry = await folder.at(at)
    if (!at || !entry || entry.key) return
    const inside = (await folder.list()).some((one) => one.path.startsWith(`${at}/`))
    if (!inside) await folder.remove(at)
  }

  const write = async (path: string, content: string, plane?: PlaneMarks) => {
    if (isKeep(path)) {
      await folder.mkdir(inSpace(parent(path)))
      return
    }
    await folder.write(inSpace(path), content)
    if (plane) planes.set(normalise(path), plane)
    else planes.delete(normalise(path))
  }

  const files: Rows['files'] = {
    async get(path) {
      if (isKeep(path)) {
        const entry = await folder.at(inSpace(parent(path)))
        return entry && !entry.key ? keepRow(normalise(parent(path)), entry) : undefined
      }
      if (!words(path)) return undefined
      const entry = await folder.at(inSpace(path))
      return entry ? fileRow(normalise(path), entry) : undefined
    },
    all: () => wordRows(),
    paths: async () =>
      (await listing())
        .filter(({ path, entry }) => !entry.key || words(path))
        .map(({ path }) => path),
    each: async (visit) => {
      for (const row of await wordRows()) visit(row)
    },
    between: (from, to) => wordRows((path) => path >= from && path <= to),
    put: (row) => write(row.path, row.content),
    write: (path, content, _at, plane) => write(path, content, plane),
    async remove(path) {
      if (isKeep(path)) return unkeep(path)
      if (!words(path)) return
      const at = inSpace(path)
      if ((await folder.at(at))?.key) await folder.remove(at)
    },
    /** Rows written and dropped one by one: what a command not taught about the tree
     *  does. Every move the commands make here goes through `tree`. */
    async move(rows, gone) {
      for (const row of rows) await write(row.path, row.content)
      for (const path of gone) {
        if (!rows.some((row) => row.path === path)) await files.remove(path)
      }
    },
  }

  const assets: Rows['assets'] = {
    async get(path) {
      if (words(path) || isKeep(path)) return undefined
      const entry = await folder.at(inSpace(path))
      return entry ? asset(normalise(path), entry) : undefined
    },
    all: assetRows,
    paths: async () =>
      (await listing())
        .filter(({ path, entry }) => entry.key && !words(path))
        .map(({ path }) => path),
    put: (row) => folder.write(inSpace(row.path), fromBase64(row.data)),
    async remove(path) {
      if (words(path) || isKeep(path)) return
      const at = inSpace(path)
      if ((await folder.at(at))?.key) await folder.remove(at)
    },
  }

  const stats: Rows['stats'] = {
    holds: (path) => folder.holds(inSpace(path)),
    all: async () =>
      (await listing()).map(({ path, entry }) => {
        const plane = planes.get(path)
        return {
          path,
          modified: entry.modified,
          created: entry.made,
          size: entry.size,
          ...(plane ? { plane } : {}),
        }
      }),
    learn: (found) => {
      for (const one of found) if (one.plane) planes.set(one.path, one.plane)
      return Promise.resolve()
    },
  }

  /** A trashed thing as Recently deleted lists it, at its address. */
  const listed = (one: Awaited<ReturnType<InternalFolder['trash']>>[number]): Trashed => ({
    id: one.id,
    kind: one.kind,
    name: one.name,
    from: address(one.from),
    trashedAt: one.trashedAt,
    ...(one.apart ? { apart: true } : {}),
  })

  return {
    files,
    assets,
    stats,
    tree: {
      move: (from, to) => folder.move(inSpace(from), inSpace(to)),
      remove: (path) => folder.remove(inSpace(path)),
      trash: {
        take: (path, item, beside) =>
          folder.toTrash(
            inSpace(path),
            item,
            beside.map((one) => inSpace(one)),
          ),
        words: (path, content, item) => folder.wordsToTrash(inSpace(path), content, item),
        list: async () => (await folder.trash()).map(listed),
        restore: (id, to) => folder.fromTrash(id, inSpace(to)),
        purge: (id) => folder.purge(id),
      },
    },
  }
}
