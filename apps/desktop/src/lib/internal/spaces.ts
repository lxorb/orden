/** The spaces a desktop keeps itself (#1068, step 4d): where they are, made, renamed and
 *  deleted, beside the folders the crate keeps as spaces.
 *
 *  Each is a folder of Orden's own in `.orden` inside the spaces folder, named as the
 *  space is, which a folder there cannot be confused with: the crate lists a dotted
 *  folder as no space, and a person browsing the spaces folder sees one hidden folder.
 *  In it are the space's bytes (`.entries`) and its index (`.index.0.json`,
 *  `.index.1.json`), and one file named as the space too, which is the space's root:
 *  the address everything else in the app holds the space by. A file, so nothing can
 *  ever be made under it - a call that reaches the crate with a path in the space by
 *  mistake fails, out loud, rather than writing a folder of its own beside the bytes.
 *
 *  New spaces are kept this way only where this device says so (`KEEP_SPACES`), until
 *  the conversion of the old ones comes (step 4e); those made already are mounted and
 *  listed whatever it says. */

import { invoke as crate } from '../native'
import { storedText } from '../stored'
import { joinPath, platform } from '../tauri'
import { safeName } from '../web/paths'
import { mountOf } from './roots'

/** Where this device keeps the spaces it keeps itself, in the spaces folder. */
export const HOME = '.orden'

/** What says new spaces on this device are kept by Orden itself: off until somebody
 *  turns it on here, in the window's storage. */
export const KEEP_SPACES = 'nib:keep-spaces'

export function keepsNewSpaces(): boolean {
  return storedText(KEEP_SPACES) === 'on'
}

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

/** Each kept space's root, by the folder it is kept in: one file there named as it. */
const rootIn = (folder: string, name: string) => joinPath(folder, name)

/** The spaces kept here, mounted as each is found, and listed. A folder of `.orden` is
 *  one by being there: its root's file is made again where it is missing (a rename cut
 *  short). */
let finding: Promise<Space[]> | null = null

function keptSpaces(): Promise<Space[]> {
  finding ??= find().finally(() => {
    finding = null
  })
  return finding
}

/** Which folder each kept space was before it was kept (step 4e), by its root. */
const fromOf = new Map<string, string>()

/** What a kept space says it was, beside its index: the folder it came from. */
const FROM = '.from'

/** The folders spaces were made of here and that are no space any more, beyond what each
 *  space says itself: one deleted after it was made of one. In `.orden`, as lines. */
const RETIRED = '.retired'

async function find(): Promise<Space[]> {
  const at = await home()
  // Not the folder's hidden files, which are the spaces' bytes and indexes: the space
  // folders, and the one file each holds that is not hidden, its root.
  const tree = await crate<Listed>('read_tree', { root: at, options: { every: true } }).catch(
    () => null,
  )
  const out: Space[] = []
  for (const one of tree?.children ?? []) {
    if (!one.is_dir) continue
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

/** The folders the kept spaces here were made of, which are not spaces any more: what
 *  is listed of the crate's folders leaves them out. */
export async function keptFrom(): Promise<string[]> {
  await keptSpaces()
  const retired = await crate<string>('read_note', { path: joinPath(await home(), RETIRED) }).catch(
    () => '',
  )
  return [...fromOf.values(), ...retired.split('\n').filter(Boolean)]
}

/** The crate's folders, without those a kept space was made of, and the kept spaces,
 *  in the crate's order: by name. */
export async function listedWith(folders: readonly Space[]): Promise<Space[]> {
  const kept = await keptSpaces()
  const gone = new Set(await keptFrom())
  return [...folders.filter((one) => !gone.has(one.path)), ...kept].sort((a, b) =>
    a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1,
  )
}

/** What lets each mounted space go, by its root. */
const letGo = new Map<string, () => void>()

function unmount(root: string) {
  letGo.get(root)?.()
  letGo.delete(root)
}

/** The space at `root` mounted, where it is not already. What mounts it is fetched
 *  with the first, so a desktop that keeps none fetches none of it. */
async function mounted(root: string, folder: string) {
  if (mountOf(root)?.mount.root === root) return
  const { mountInternal } = await import('./mount')
  letGo.set(root, await mountInternal(root, folder, { foldsCase: foldsCase() }))
}

/** A name for a new space that no space here has, kept or a folder: `name`, else
 *  `name 2`, `name 3`, as the crate numbers a folder. */
function freeName(wanted: string, taken: readonly string[]): string {
  const used = (one: string) => taken.some((name) => same(name, one))
  if (!used(wanted)) return wanted
  for (let counter = 2; ; counter += 1) {
    const one = `${wanted} ${String(counter)}`
    if (!used(one)) return one
  }
}

/** Every space's name, the crate's folders and the kept ones. */
async function names(): Promise<string[]> {
  const folders = await crate<Space[]>('list_spaces').catch(() => [])
  return [...folders, ...(await keptSpaces())].map((one) => one.name)
}

/** A new space kept by Orden itself. */
export async function makeKept(name: string): Promise<Space> {
  const wanted = safeName(name)
  if (!wanted) throw new Error('that name cannot be used for a space')
  const chosen = freeName(wanted, await names())
  const folder = joinPath(await home(), chosen)
  await crate('create_folder', { path: folder })
  return { name: chosen, path: await mountKept(folder, chosen) }
}

/** The kept space in `folder`, its index written already, given its root and mounted,
 *  and said to have been the folder `from` where it was one. Answers its root. */
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

/** The kept space at `from` under another name: its folder renamed, and mounted again
 *  at the root that name gives it. Nothing in it moves. */
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
  await crate('rename_note', { from: was, to: folder })
  unmount(found.mount.root)
  await crate('delete_note', { path: rootIn(folder, old) }).catch(() => undefined)
  const root = rootIn(folder, wanted)
  await crate('write_note', { path: root, content: '' })
  await mounted(root, folder)
  const madeOf = fromOf.get(from)
  fromOf.delete(from)
  if (madeOf) fromOf.set(root, madeOf)
  return { name: wanted, path: root }
}

/** The kept space at `root` into this device's trash, its folder whole, so Recently
 *  deleted gives it back as it was; or gone for good, with `forGood`. */
export async function removeKept(root: string, forGood: boolean): Promise<unknown> {
  const found = mountOf(root)
  if (!found || found.inside) throw new Error(`${root} is not a space kept here`)
  const folder = found.mount.folder.name
  await found.mount.folder.flush()
  // The folder it was made of stays no space, whatever becomes of this one.
  const was = fromOf.get(root)
  if (was) {
    const path = joinPath(await home(), RETIRED)
    const said = await crate<string>('read_note', { path }).catch(() => '')
    await crate('write_note', { path, content: `${said}${was}\n` })
    fromOf.delete(root)
  }
  unmount(root)
  return forGood
    ? crate('delete_folder', { path: folder })
    : crate('trash_item', { path: folder, kind: 'space' })
}
