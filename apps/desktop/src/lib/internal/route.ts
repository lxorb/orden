import { joinPath } from '../tauri'
import { normalise } from '../web/paths'
import type { Trashed } from '../web/store'
import { type Mounted, mountOf, mounts as mounted, PATH_ARGS } from './roots'

async function crate<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('../native')
  return invoke<T>(command, args)
}

async function web<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { webInvoke } = await import('../web/commands')
  return webInvoke<T>(command, args)
}

function outOf(mount: Mounted, path: string): string {
  const at = normalise(path)
  if (at === mount.web) return mount.root
  if (!at.startsWith(`${mount.web}/`)) return path
  return joinPath(mount.root, at.slice(mount.web.length + 1))
}

interface Entry {
  name: string
  path: string
  children?: Entry[]
}

function treeOut(mount: Mounted, entry: Entry, top: boolean): Entry {
  return {
    ...entry,
    ...(top && normalise(entry.path) === mount.web
      ? {
          name:
            mount.root
              .replace(/[\\/]+$/, '')
              .split(/[\\/]/)
              .pop() ?? entry.name,
        }
      : {}),
    path: outOf(mount, entry.path),
    ...(entry.children
      ? { children: entry.children.map((one) => treeOut(mount, one, false)) }
      : {}),
  }
}

function trashedOut(entry: Trashed, mounts: readonly Mounted[]): Trashed {
  for (const mount of mounts) {
    const from = outOf(mount, entry.from)
    if (from !== entry.from) return { ...entry, from }
  }
  return entry
}

async function trash<T>(
  command: string,
  args: Record<string, unknown>,
  mounts: readonly Mounted[],
): Promise<T> {
  const kept = (await web<Trashed[]>('list_trash')).map((one) => trashedOut(one, mounts))
  if (command === 'list_trash') {
    const all = [...(await crate<Trashed[]>('list_trash')), ...kept]
    return all.sort((a, b) => b.trashedAt - a.trashedAt) as T
  }
  if (command === 'purge_trash_older_than') {
    const [here, there] = await Promise.all([
      crate<number>(command, args),
      web<number>(command, args),
    ])
    return (here + there) as T
  }
  if (!kept.some((one) => one.id === args.id)) return crate<T>(command, args)
  const answer = await web<unknown>(command, args)
  if (command !== 'restore_trash' || typeof answer !== 'string') return answer as T
  for (const mount of mounts) {
    const back = outOf(mount, answer)
    if (back !== answer) return back as T
  }
  return answer as T
}

async function what(path: string): Promise<{ rest: string; dir: boolean }[]> {
  const kept = mountOf(path)
  const { SIDECAR } = await import('../pdf/highlights')
  const beside = [SIDECAR, '.pdf', `.pdf${SIDECAR}`]
  if (kept) {
    const top = kept.inside
    const out: { rest: string; dir: boolean }[] = []
    for (const { path: one, entry } of await kept.mount.folder.list()) {
      const rest = one === top ? '' : one.startsWith(`${top}/`) ? one.slice(top.length) : null
      if (rest !== null) out.push({ rest, dir: !entry.key })
      else if (entry.key && beside.some((end) => one === `${top}${end}`)) {
        out.push({ rest: one.slice(top.length), dir: false })
      }
    }
    return out
  }
  if (await crate<unknown>('file_stamp', { path }).catch(() => null)) {
    const out = [{ rest: '', dir: false }]
    for (const end of beside) {
      if (await crate<unknown>('file_stamp', { path: `${path}${end}` }).catch(() => null)) {
        out.push({ rest: end, dir: false })
      }
    }
    return out
  }
  const tree = await crate<Listed>('read_tree', {
    root: path,
    options: { every: true, papers: true, showHidden: true },
  }).catch(() => null)
  if (!tree) return []
  const out: { rest: string; dir: boolean }[] = [{ rest: '', dir: true }]
  const base = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const walk = (node: Listed) => {
    for (const child of node.children ?? []) {
      out.push({ rest: child.path.replace(/\\/g, '/').slice(base.length), dir: child.is_dir })
      if (child.is_dir) walk(child)
    }
  }
  walk(tree)
  return out
}

interface Listed {
  path: string
  is_dir: boolean
  children?: Listed[]
}

function addressed(path: string): { kept: boolean; at: string } {
  const found = mountOf(path)
  if (!found) return { kept: false, at: path }
  return { kept: true, at: found.inside ? `${found.mount.web}/${found.inside}` : found.mount.web }
}

async function across<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (command !== 'rename_note' && command !== 'copy_path') {
    throw new Error(`${command} cannot reach a space Orden keeps and a folder at once`)
  }
  const from = String(args.from)
  const to = String(args.to)
  const going = (await what(from)).sort((a, b) => a.rest.length - b.rest.length)
  if (!going.length) throw new Error(`nothing is at ${from}`)
  if ((await what(to)).length) throw new Error('something already lives there')

  const source = addressed(from)
  const target = addressed(to)
  const join = (base: string, rest: string, kept: boolean) =>
    !rest ? base : kept || !rest.startsWith('/') ? `${base}${rest}` : joinPath(base, rest.slice(1))
  for (const one of going) {
    const into = join(target.at, one.rest, target.kept)
    if (one.dir) {
      await (target.kept ? web : crate)('create_folder', { path: into })
      continue
    }
    const bytes = source.kept
      ? await keptBytes(from, one.rest)
      : new Uint8Array(await crate<ArrayBuffer>('read_file', { path: join(from, one.rest, false) }))
    await (target.kept ? web : crate)('write_bytes', { path: into, bytes })
  }
  if (command === 'copy_path') return undefined as T

  const remove = (call: string, path: string) => (source.kept ? web : crate)(call, { path })
  if (going[0]?.dir) {
    await remove('delete_folder', source.at)
    return undefined as T
  }
  await remove('delete_note', source.at)
  for (const one of going.slice(1)) {
    await remove('delete_note', join(source.at, one.rest, source.kept)).catch(() => undefined)
  }
  return undefined as T
}

async function keptBytes(path: string, rest: string): Promise<Uint8Array> {
  const found = mountOf(path)
  const bytes = found ? await found.mount.folder.read(`${found.inside}${rest}`) : null
  if (!bytes) throw new Error(`nothing is at ${path}${rest}`)
  return bytes
}

const SPACE_COMMANDS = new Set(['list_spaces', 'create_space', 'rename_space', 'delete_space'])

async function spaces(
  command: string,
  args: Record<string, unknown>,
): Promise<{ done: true; value: unknown } | { done: false }> {
  const kept = await import('./spaces')
  const own = (path: unknown) => typeof path === 'string' && mountOf(path)?.inside === ''
  switch (command) {
    case 'list_spaces':
      return {
        done: true,
        value: await kept.listedWith(await crate<{ name: string; path: string }[]>(command)),
      }
    case 'create_space':
      return { done: true, value: await kept.makeKept(String(args.name)) }
    case 'rename_space':
      if (!own(args.from)) return { done: false }
      return {
        done: true,
        value: await kept.renameKept(String(args.from), String(args.name)),
      }
    case 'delete_space':
    case 'trash_item':
      if (!own(args.path)) return { done: false }
      return {
        done: true,
        value: await kept.removeKept(String(args.path), command === 'delete_space'),
      }
    default:
      return { done: false }
  }
}

export async function internalInvoke<T>(
  command: string,
  args: Record<string, unknown> = {},
  mounts: readonly Mounted[] = mounted(),
): Promise<T> {
  if (command === 'pty_spawn') {
    const asked = typeof args.folder === 'string' && !__EVEN_PLUGIN__ ? args.folder : null
    if (asked === null) return crate<T>(command, { ...args, folder: null })
    const { workingFolder } = await import('./work')
    const folder = await workingFolder(asked).catch(() => null)
    return crate<T>(command, { ...args, folder })
  }
  if (command === 'same_pdf') return null as T
  if (
    command === 'list_trash' ||
    command === 'restore_trash' ||
    command === 'purge_trash' ||
    command === 'purge_trash_older_than'
  ) {
    return trash<T>(command, args, mounts)
  }

  if (SPACE_COMMANDS.has(command) || (command === 'trash_item' && args.kind === 'space')) {
    const answer = await spaces(command, args)
    if (answer.done) return answer.value as T
  }

  const inWeb: Record<string, unknown> = { ...args }
  const named = new Set<Mounted | null>()
  for (const key of PATH_ARGS) {
    const value = args[key]
    if (typeof value !== 'string') continue
    const found = mountOf(value)
    named.add(found?.mount ?? null)
    if (found) inWeb[key] = found.inside ? `${found.mount.web}/${found.inside}` : found.mount.web
  }
  if (named.size > 1) {
    if (named.has(null)) return across<T>(command, args)
    return web<T>(command, inWeb)
  }
  const [mount] = [...named]
  if (!mount) return crate<T>(command, args)
  const pathArg = typeof args.path === 'string' ? args.path : args.root
  const at = (typeof pathArg === 'string' ? mountOf(pathArg)?.inside : undefined) ?? ''

  switch (command) {
    case 'read_file': {
      const bytes = await mount.folder.read(at)
      if (!bytes) throw new Error(`no file at ${String(args.path)}`)
      return bytes.slice().buffer as T
    }
    case 'file_stamp': {
      const entry = await mount.folder.at(at)
      return (entry?.key ? { modified: entry.modified, len: entry.size } : null) as T
    }
    case 'file_there':
      return ((await mount.folder.at(at)) !== null) as T
    case 'read_tree': {
      const entry = await mount.folder.at(at)
      if (at && (!entry || entry.key)) throw new Error(`${String(args.root)} is not a folder`)
      const tree = await web<Entry>(command, inWeb)
      return treeOut(mount, tree, true) as T
    }
    case 'trash_item':
    case 'trash_words': {
      const entry = await web<Trashed>(command, inWeb)
      return { ...entry, from: outOf(mount, entry.from) } as T
    }
    default:
      return web<T>(command, inWeb)
  }
}
