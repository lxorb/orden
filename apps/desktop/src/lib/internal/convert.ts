import { nameKey } from '@orden/sync-core/tree'
import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { log } from '../log'
import { invoke as crate } from '../native'
import { joinPath, platform } from '../tauri'
import type { HoldsSpaces } from '../workspace/spaces'
import { folderBytes } from './bytes'
import { InternalFolder } from './folder'
import { mountOf } from './roots'
import { CONVERTING, freeName, HOME, keptFrom, mountKept } from './spaces'

interface Listed {
  name: string
  path: string
  is_dir: boolean
  children?: Listed[]
}

interface Told {
  progress(done: number, total: number): void
  failed(reason: string): void
}

const quiet: Told = { progress: () => undefined, failed: () => undefined }

const SAVE_EVERY = 200

const SAVE_AFTER = 2000

const FAILED_SHOWN = 20000

interface Stamp {
  modified: number
  len: number
}

const foldsCase = () => ['windows', 'macos', 'ios', ''].includes(platform())

const INBOX = '.Inbox.md'

const VAULT = ['.obsidian/app.json', '.obsidian/workspace.json', '.obsidian/core-plugins.json']

async function contents(root: string): Promise<{ path: string; dir: boolean }[]> {
  const tree = await crate<Listed>('read_tree', {
    root,
    options: { every: true, papers: true, showHidden: false },
  })
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const out: { path: string; dir: boolean }[] = []
  const walk = (node: Listed) => {
    for (const child of node.children ?? []) {
      out.push({ path: child.path.replace(/\\/g, '/').slice(base.length + 1), dir: child.is_dir })
      if (child.is_dir) walk(child)
    }
  }
  walk(tree)
  for (const own of [INBOX, ...VAULT]) {
    if (await crate<Stamp | null>('file_stamp', { path: joinPath(root, own) }).catch(() => null)) {
      out.push({ path: own, dir: false })
    }
  }
  return out
}

async function bytesAt(path: string): Promise<Uint8Array> {
  return new Uint8Array(await crate<ArrayBuffer>('read_file', { path }))
}

function same(one: Uint8Array, other: Uint8Array | null): boolean {
  if (other?.byteLength !== one.byteLength) return false
  for (let at = 0; at < one.byteLength; at += 1) if (one[at] !== other[at]) return false
  return true
}

async function copied(
  root: string,
  into: InternalFolder,
  only: ReadonlySet<string> | null = null,
  told: Told = quiet,
): Promise<Map<string, Stamp | null>> {
  const stamps = new Map<string, Stamp | null>()
  const all = await contents(root)
  const total = all.filter((one) => !one.dir && (!only || only.has(one.path))).length
  const seen = new Set<string>()
  const fold = (path: string) => (foldsCase() ? nameKey(path) : path.normalize('NFC'))
  let done = 0
  let unsaved = 0
  let saved = Date.now()
  for (const one of all) {
    if (only && !only.has(one.path)) continue
    if (one.dir) {
      await into.adopt(one.path, null)
      continue
    }
    if (seen.has(fold(one.path))) {
      throw new Error(`${one.path} and another file are one name in a space kept here`)
    }
    seen.add(fold(one.path))
    const at = joinPath(root, one.path)
    stamps.set(one.path, await crate<Stamp | null>('file_stamp', { path: at }).catch(() => null))
    const bytes = await bytesAt(at)
    const had = into.atNow(one.path)
    if (only || had?.size !== bytes.byteLength || !same(bytes, await into.read(one.path))) {
      await into.adopt(one.path, bytes)
      if (!same(bytes, await into.read(one.path))) {
        throw new Error(`${one.path} did not read back as it was written`)
      }
      unsaved += 1
    }
    done += 1
    told.progress(done, total)
    if (unsaved >= SAVE_EVERY || (unsaved && Date.now() - saved > SAVE_AFTER)) {
      await into.save()
      unsaved = 0
      saved = Date.now()
    }
  }
  await into.save()
  return stamps
}

async function backedUp(from: string, name: string): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', ' ')
  const backups = joinPath(joinPath(await crate<string>('spaces_root'), HOME), '.backups')
  let at = joinPath(backups, `${name} ${stamp}`)
  for (let counter = 2; await crate<boolean>('path_taken', { path: at }); counter += 1) {
    at = joinPath(backups, `${name} ${stamp} ${String(counter)}`)
  }
  await crate('copy_path', { from, to: at })
  return at
}

let turn: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(run: () => Promise<T>): Promise<T> {
  const mine = turn.then(run, run)
  turn = mine.catch(() => undefined)
  return mine
}

export function convertSpace(ws: HoldsSpaces, id: string, told: Told = quiet): Promise<boolean> {
  return oneAtATime(() => converting(ws, id, told))
}

async function begun(
  home: string,
  from: string,
): Promise<{ taken: string[]; folder: string | null; backup: string | null }> {
  const tree = await crate<Listed>('read_tree', { root: home, options: { every: true } }).catch(
    () => null,
  )
  const taken: string[] = []
  for (const one of tree?.children ?? []) {
    if (!one.is_dir) continue
    taken.push(one.name)
    const said = await crate<string>('read_note', { path: joinPath(one.path, CONVERTING) }).catch(
      () => '',
    )
    const [was, backup] = said.split('\n')
    if (was === from)
      return { taken, folder: one.path, backup: backup?.trim() ? backup.trim() : null }
  }
  return { taken, folder: null, backup: null }
}

async function opened(folder: string): Promise<InternalFolder> {
  const world = { now: () => Date.now(), key: () => crypto.randomUUID(), foldsCase: foldsCase() }
  return InternalFolder.open(folder, folderBytes(folder), world)
}

const nameIn = (folder: string) =>
  folder
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? ''

async function converting(ws: HoldsSpaces, id: string, told: Told): Promise<boolean> {
  const space = ws.spaces.find((one) => one.id === id)
  if (!space || mountOf(space.root)) return false
  const from = space.root
  if ((await keptFrom()).includes(from)) return false
  const home = joinPath(await crate<string>('spaces_root'), HOME)
  const found = await begun(home, from)
  const taken = [...found.taken, ...ws.spaces.filter((one) => one !== space).map((one) => one.name)]
  let folder = found.folder ?? joinPath(home, freeName(space.name, taken))
  while (!found.folder && (await crate<boolean>('path_taken', { path: folder }))) {
    taken.push(nameIn(folder))
    folder = joinPath(home, freeName(space.name, taken))
  }
  const name = nameIn(folder)
  const marker = joinPath(folder, CONVERTING)

  let backup = found.backup
  if (!backup || !(await crate<boolean>('path_taken', { path: backup }).catch(() => false))) {
    try {
      backup = await backedUp(from, space.name)
    } catch (error) {
      const reason = `it could not be backed up: ${String(error)}`
      log('error', `${space.name} stays a folder: ${reason}`)
      told.failed(reason)
      return false
    }
  }
  await crate('write_note', { path: marker, content: `${from}\n${backup}\n` })
  let into: InternalFolder
  try {
    into = await opened(folder)
  } catch {
    await crate('delete_folder', { path: folder }).catch(() => undefined)
    await crate('write_note', { path: marker, content: `${from}\n${backup}\n` })
    into = await opened(folder)
  }
  try {
    const stamps = await copied(from, into, null, told)
    const done = { converted: false }
    await ws.holdingUnder(from, async () => {
      const now = await contents(from)
      const changed = new Set<string>()
      for (const one of now) {
        if (one.dir) continue
        const was = stamps.get(one.path)
        const is = await crate<Stamp | null>('file_stamp', { path: joinPath(from, one.path) })
        if (!is || is.modified !== was?.modified || is.len !== was.len) changed.add(one.path)
      }
      for (const one of now) if (one.dir && !(await into.at(one.path))) changed.add(one.path)
      const there = new Set<string>()
      for (const { path } of now) {
        for (let at = path; at; at = at.includes('/') ? at.slice(0, at.lastIndexOf('/')) : '') {
          there.add(at)
        }
      }
      for (const { path } of await into.list()) if (!there.has(path)) await into.remove(path)
      await copied(from, into, changed)
      await into.flush()
      into.close()

      const root = await mountKept(folder, name, from)
      await crate('delete_note', { path: marker })
      if (name !== space.name) {
        const was = space.name
        space.name = name
        const { followSpaceName } = await import('../views/space-follow')
        followSpaceName(
          was,
          name,
          ws.tabs,
          ws.spaces.filter((one) => one !== space),
        )
      }
      space.root = root
      await ws.fileMoved(from, root, 'space')
      await crate('rehome_snapshots', { from, to: root }).catch(() => 0)
      done.converted = true
    })
    if (!done.converted) return false
    ws.persist()
    await ws.loadTree()
    return true
  } catch (error) {
    into.close()
    await crate('delete_folder', { path: folder }).catch(() => undefined)
    log('error', `${space.name} stays a folder: ${String(error)}`)
    told.failed(String(error))
    return false
  }
}

export async function convertAll(ws: HoldsSpaces): Promise<void> {
  const done = new Set(await keptFrom())
  const failed: string[] = []
  for (const space of [...ws.spaces]) {
    if (mountOf(space.root) || done.has(space.root)) continue
    const name = space.name
    await busy.run(t('Moving {name} into Orden’s storage', { name }), () =>
      convertSpace(ws, space.id, {
        progress: (did, total) => busy.tell(t('{done} of {total}', { done: did, total })),
        failed: () => failed.push(name),
      }),
    )
    busy.tell(null)
  }
  if (failed.length) {
    busy.failed(
      t(
        'Could not move {names} into Orden’s storage yet. Nothing was lost: they stay folders for now, and Orden tries again the next time it starts.',
        { names: failed.join(', ') },
      ),
      FAILED_SHOWN,
    )
  }
}
