import { freeName as freeWhole } from '@orden/markdown/paths'
import { invoke as crate } from '../crate/src/api'
import { joinPath, platform, safeName } from '../platform/src/api'
import { mountOf } from './roots'

export const HOME = '.orden'

interface Space {
  name: string
  path: string
}

interface Listed {
  name: string
  path: string
  is_dir: boolean
  children?: Listed[]
}

const foldsCase = () => ['windows', 'macos', 'ios', ''].includes(platform())

const same = (one: string, other: string) =>
  foldsCase() ? one.toLowerCase() === other.toLowerCase() : one === other

async function home(): Promise<string> {
  return joinPath(await crate<string>('spaces_root'), HOME)
}

const rootIn = (folder: string, name: string) => joinPath(folder, name)

let finding: Promise<Space[]> | null = null

export function keptSpaces(): Promise<Space[]> {
  finding ??= find().finally(() => {
    finding = null
  })
  return finding
}

const fromOf = new Map<string, string>()

const FROM = '.from'

const RETIRED = '.retired'

export const CONVERTING = '.converting'

async function lines(name: string): Promise<string[]> {
  const said = await crate<string>('read_note', { path: joinPath(await home(), name) }).catch(
    () => '',
  )
  return said.split('\n').filter(Boolean)
}

async function addLine(name: string, line: string): Promise<void> {
  const had = await lines(name)
  if (had.includes(line)) return
  await crate('write_note', {
    path: joinPath(await home(), name),
    content: `${[...had, line].join('\n')}\n`,
  })
}

async function find(): Promise<Space[]> {
  const at = await home()
  const tree = await crate<Listed>('read_tree', { root: at, options: { every: true } }).catch(
    () => null,
  )
  const out: Space[] = []
  for (const one of tree?.children ?? []) {
    if (!one.is_dir) continue
    const converting = joinPath(one.path, CONVERTING)
    if (await crate<unknown>('file_stamp', { path: converting }).catch(() => null)) continue
    const root = rootIn(one.path, one.name)
    if (!one.children?.some((child) => !child.is_dir && child.name === one.name)) {
      await crate('write_note', { path: root, content: '' }).catch(() => undefined)
    }
    await mounted(root, one.path)
    const was = await crate<string>('read_note', { path: joinPath(one.path, FROM) }).catch(() => '')
    if (was.trim()) fromOf.set(root, was.trim())
    out.push({ name: one.name, path: root })
  }
  return out
}

export async function keptFrom(): Promise<string[]> {
  await keptSpaces()
  return [...fromOf.values(), ...(await lines(RETIRED))]
}

export async function keptCameFrom(): Promise<{ root: string; from: string }[]> {
  await keptSpaces()
  return [...fromOf].map(([root, from]) => ({ root, from }))
}

export async function listedWith(folders: readonly Space[]): Promise<Space[]> {
  const kept = await keptSpaces()
  const gone = new Set(await keptFrom())
  return [...folders.filter((one) => !gone.has(one.path)), ...kept].sort((a, b) =>
    a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1,
  )
}

const letGo = new Map<string, () => void>()

function unmount(root: string) {
  letGo.get(root)?.()
  letGo.delete(root)
}

const work = () => import('./work')

async function mounted(root: string, folder: string) {
  if (mountOf(root)?.mount.root === root) return
  const { mountInternal } = await import('./mount')
  letGo.set(root, await mountInternal(root, folder, { foldsCase: foldsCase() }))
}

export function freeName(wanted: string, taken: readonly string[]): string {
  return freeWhole(wanted, (one) => taken.some((name) => same(name, one)))
}

async function names(): Promise<string[]> {
  const folders = await crate<Space[]>('list_spaces').catch(() => [])
  return [...folders, ...(await keptSpaces())].map((one) => one.name)
}

export async function makeKept(name: string): Promise<Space> {
  const wanted = safeName(name)
  if (!wanted) throw new Error('that name cannot be used for a space')
  const chosen = freeName(wanted, await names())
  const folder = joinPath(await home(), chosen)
  await crate('create_folder', { path: folder })
  return { name: chosen, path: await mountKept(folder, chosen) }
}

export async function mountKept(folder: string, name: string, from?: string): Promise<string> {
  const root = rootIn(folder, name)
  await crate('write_note', { path: root, content: '' })
  if (from) {
    await crate('write_note', { path: joinPath(folder, FROM), content: from })
    fromOf.set(root, from)
  }
  await mounted(root, folder)
  return root
}

export async function renameKept(from: string, name: string): Promise<Space> {
  const found = mountOf(from)
  if (!found || found.inside) throw new Error(`${from} is not a space kept here`)
  const wanted = safeName(name)
  if (!wanted) throw new Error('that name cannot be used for a space')
  const was = found.mount.folder.name
  const old =
    was
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  if (wanted === old) return { name: old, path: from }
  const others = (await names()).filter((one) => !same(one, old))
  if (others.some((one) => same(one, wanted))) throw new Error(`there is a space called ${wanted}`)

  const folder = joinPath(await home(), wanted)
  await found.mount.folder.flush()
  if (!__EVEN_PLUGIN__) await (await work()).letGoWorking(was)
  await crate('rename_note', { from: was, to: folder })
  unmount(found.mount.root)
  await crate('delete_note', { path: rootIn(folder, old) }).catch(() => undefined)
  const root = rootIn(folder, wanted)
  await crate('write_note', { path: root, content: '' })
  await mounted(root, folder)
  if (!__EVEN_PLUGIN__) await (await work()).movedWorking(was, folder, root)
  const madeOf = fromOf.get(from)
  fromOf.delete(from)
  if (madeOf) fromOf.set(root, madeOf)
  return { name: wanted, path: root }
}

export async function removeKept(root: string, forGood: boolean): Promise<unknown> {
  const found = mountOf(root)
  if (!found || found.inside) throw new Error(`${root} is not a space kept here`)
  const folder = found.mount.folder.name
  await found.mount.folder.flush()
  if (!__EVEN_PLUGIN__) await (await work()).letGoWorking(folder, 'gone')
  const was = fromOf.get(root)
  if (was) {
    await addLine(RETIRED, was)
    fromOf.delete(root)
  }
  unmount(root)
  return forGood
    ? crate('delete_folder', { path: folder })
    : crate('trash_item', { path: folder, kind: 'space' })
}
