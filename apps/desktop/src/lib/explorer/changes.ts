import { freePath } from '@orden/markdown/paths'
import { message, prompt } from '../ui-kit/src/api'
import type { Picked as Brought } from '../import/sources'
import { fileClipboard } from '../list-landing.svelte'
import { folderOf, nameOf, invoke, joinPath } from '../platform/src/api'
import { workspace } from '../workspace.svelte'
import type { OutsideStep } from '../workspace/undo.svelte'
import {
  type Clash,
  clashesIn,
  deleteForGood,
  listFolder,
  makeIn,
  peekAt,
  renameTo,
  transfer,
  type Transferred,
  trashPaths,
  type Trashing,
} from './commands'
import { parentOf } from './crumbs'
import { jobs } from './jobs.svelte'
import { inASpace } from './open'
import { crossing } from './renaming'
import type { ExplorerView } from './view.svelte'

const MOST_BROUGHT = 48 * 1024 * 1024

function record(steps: OutsideStep[]) {
  if (steps.length) workspace.undone.record({ kind: 'outside', steps })
}

function split(paths: readonly string[]): { inside: string[]; outside: string[] } {
  return {
    inside: paths.filter((one) => inASpace(one)),
    outside: paths.filter((one) => !inASpace(one)),
  }
}

export function changeable(view: ExplorerView): boolean {
  const listing = view.listing
  return !!listing && !listing.own && (!listing.spaces || inASpace(listing.path))
}

export function takenNames(names: readonly string[]): Set<string> {
  return new Set(names.map((one) => one.toLowerCase()))
}

export function freeName(taken: ReadonlySet<string>, name: string): string {
  return freePath(name, (candidate) => taken.has(candidate.toLowerCase()))
}

export async function newFolder(view: ExplorerView) {
  const folder = view.listing?.path
  if (!folder || !changeable(view)) return
  try {
    let path: string
    if (inASpace(folder)) {
      const all = view.listing?.entries.map((one) => one.name) ?? []
      path = joinPath(folder, freeName(takenNames(all), 'New folder'))
      await invoke('create_folder', { path })
      await workspace.loadTree()
    } else {
      path = await makeIn(folder, 'New folder', false)
      record([{ op: 'made', path }])
    }
    await view.reload()
    const name = nameOf(path)
    if (!view.names.includes(name)) {
      view.filter = ''
      view.endSearch()
    }
    view.pick(name, 'one')
    view.renaming = name
  } catch (error) {
    view.tell(message(error, 'could not make the folder'))
  }
}

export async function renamePath(view: ExplorerView, from: string, name: string) {
  const clean = name.trim()
  if (!clean || clean === nameOf(from)) return
  try {
    let to: string
    if (inASpace(from)) {
      await workspace.rename(from, clean)
      to = joinPath(folderOf(from), clean)
    } else {
      to = await renameTo(from, clean)
      record([{ op: 'moved', pairs: [{ from, to }] }])
    }
    const picked = view.search ? view.search.moved(from, to) : nameOf(to)
    await view.reload()
    if (picked !== null) view.pick(picked, 'one')
  } catch (error) {
    view.tell(message(error, 'could not rename this'))
  }
}

export async function trash(view: ExplorerView, paths: readonly string[]) {
  if (!paths.length || !changeable(view)) return
  const { inside, outside } = split(paths)
  await workspace.undone.batch(async () => {
    if (inside.length) await workspace.removeMany(inside)
    if (!outside.length) return
    try {
      record([{ op: 'trashed', tickets: await trashPaths(outside) }])
    } catch (error) {
      const stopped = error as Partial<Trashing>
      if (stopped.went?.length) record([{ op: 'trashed', tickets: stopped.went }])
      view.tell(message(stopped.why ?? error, 'could not move this to the trash'))
    }
  })
  await view.reload()
}

export async function removeForGood(view: ExplorerView, paths: readonly string[]) {
  if (!paths.length || !changeable(view)) return
  const { inside, outside } = split(paths)
  if (inside.length) await trash(view, inside)
  if (!outside.length) return
  const sure = await prompt.confirm({
    title:
      outside.length === 1 ? 'Delete 1 item for good?' : `Delete ${outside.length} items for good?`,
    detail: 'This cannot be undone.',
    confirmLabel: 'Delete for good',
    danger: true,
  })
  if (!sure) return
  try {
    await deleteForGood(outside)
  } catch (error) {
    view.tell(message(error, 'could not delete this'))
  }
  await view.reload()
}

export async function paste(view: ExplorerView, into?: string) {
  const folder = into ?? view.listing?.path
  const paths = [...fileClipboard.paths]
  if (!folder || !paths.length || !changeable(view)) return
  const cut = fileClipboard.cut
  if (cut) fileClipboard.hold([], false)
  await carry(view, paths, folder, cut ? 'move' : 'copy')
}

export async function duplicate(view: ExplorerView, paths: readonly string[]) {
  const folder = view.listing?.path
  if (!folder || !paths.length || !changeable(view)) return
  const beside = new Map<string, string[]>()
  for (const path of paths) {
    const at = (view.search ? parentOf(path) : null) ?? folder
    const some = beside.get(at)
    if (some) some.push(path)
    else beside.set(at, [path])
  }
  await workspace.undone.batch(async () => {
    for (const [at, some] of beside) await carry(view, some, at, 'copy')
  })
}

export async function carry(
  view: ExplorerView | null,
  sources: readonly string[],
  folder: string,
  how: 'copy' | 'move',
) {
  const { inside, outside } = split(sources)
  const tell = (said: string) => view?.tell(said)
  await workspace.undone.batch(async () => {
    if (inASpace(folder)) {
      if (inside.length)
        await (how === 'move'
          ? workspace.moveMany(inside, folder)
          : workspace.copyMany(inside, folder))
      if (outside.length) await bringInto(outside, folder, how === 'move', tell)
      return
    }
    const clash = await clashFor([...inside, ...outside], folder)
    if (clash === null) return
    const staying = how === 'move' ? inside : []
    const stayed = await across([...outside, ...inside], folder, how, clash, tell, staying)
    if (stayed.length) await workspace.removeMany(stayed)
  })
  await view?.reload()
}

async function across(
  sources: readonly string[],
  folder: string,
  how: 'copy' | 'move',
  clash: Clash,
  tell: (said: string) => void,
  staying: readonly string[],
): Promise<string[]> {
  const label =
    how === 'move'
      ? sources.length === 1
        ? 'Moving 1 item'
        : `Moving ${sources.length} items`
      : sources.length === 1
        ? 'Copying 1 item'
        : `Copying ${sources.length} items`
  let done: Transferred
  try {
    done = await jobs.run(label, (id) => transfer(id, sources, folder, how, clash, staying))
  } catch (error) {
    tell(message(error, 'could not copy this'))
    return []
  }
  const went = done.done.filter((one) => !one.stayed).map(({ from, to }) => ({ from, to }))
  const kept = done.done.filter((one) => one.stayed).map(({ from, to }) => ({ from, to }))
  const steps: OutsideStep[] = []
  if (done.replaced.length) steps.push({ op: 'replaced', tickets: done.replaced })
  if (went.length) steps.push({ op: how === 'move' ? 'moved' : 'copied', pairs: went })
  if (kept.length) steps.push({ op: 'copied', pairs: kept })
  record(steps)
  const [failed] = done.failed
  if (failed) tell(`${nameOf(failed.path)}: ${failed.why}`)
  return kept.map((one) => one.from)
}

async function clashFor(sources: readonly string[], folder: string): Promise<Clash | null> {
  const names = await clashesIn(sources, folder).catch(() => [])
  if (!names.length) return 'keep'
  const [only, ...more] = names
  const answer = await prompt.choose({
    title:
      only !== undefined && !more.length
        ? `${only} is already here`
        : names.length === 1
          ? '1 name is already here'
          : `${names.length} names are already here`,
    options: [
      { id: 'keep', label: 'Keep both', lands: true },
      { id: 'replace', label: 'Replace', danger: true },
      { id: 'skip', label: 'Skip' },
    ],
  })
  return answer === 'keep' || answer === 'replace' || answer === 'skip' ? answer : null
}

async function bringInto(
  paths: readonly string[],
  folder: string,
  moving: boolean,
  tell: (said: string) => void,
) {
  const brought: Brought[] = []
  const whole: string[] = []
  for (const path of paths) {
    try {
      await gather(path, nameOf(path), brought)
      whole.push(path)
    } catch (error) {
      tell(message(error, 'could not copy this'))
    }
  }
  if (!brought.length) return
  await workspace.bringIn(brought, folder)
  if (moving && whole.length) record([{ op: 'trashed', tickets: await trashPaths(whole) }])
}

async function gather(path: string, under: string, into: Brought[]) {
  const listing = await listFolder(path).catch(() => null)
  if (!listing) {
    into.push(broughtFile(path, under))
    return
  }
  for (const one of listing.entries) {
    const inner = joinPath(listing.path, one.name)
    if (one.folder) await gather(inner, `${under}/${one.name}`, into)
    else into.push(broughtFile(inner, `${under}/${one.name}`))
  }
}

function broughtFile(path: string, under: string): Brought {
  const nested = under.includes('/')
  return {
    name: nameOf(under),
    ...(nested ? { webkitRelativePath: under } : {}),
    arrayBuffer: async () => {
      const read = await peekAt(path, MOST_BROUGHT)
      if (read.cut) throw new Error('This file is too large to bring into a space.')
      return read.bytes.slice().buffer
    },
  }
}

async function putBack(
  staged: readonly { from: string; at: string }[],
  done: readonly { from: string; to: string }[],
) {
  const left = new Set(staged.map((one) => one.from))
  for (const [index, { from, to }] of [...done.entries()].reverse()) {
    const aside = staged[index]?.at ?? from
    await renameTo(to, nameOf(aside)).catch(() => left.delete(from))
  }
  for (const { from, at } of staged) {
    if (left.has(from) && at !== from) await renameTo(at, nameOf(from)).catch(() => undefined)
  }
}

export async function renameMany(
  view: ExplorerView,
  pairs: readonly { from: string; name: string }[],
) {
  const moving = pairs.filter(({ from, name }) => nameOf(from) !== name)
  if (!moving.length || !changeable(view)) return
  const folder = view.listing?.path ?? ''
  if (inASpace(folder)) {
    let failed: unknown = null
    const went: { from: string; to: string }[] = []
    await workspace.undone.batch(async () => {
      for (const { from, name } of moving) {
        await workspace.rename(from, name).then(
          () => went.push({ from, to: joinPath(folderOf(from), name) }),
          (error: unknown) => (failed ??= error),
        )
      }
    })
    if (failed !== null) view.tell(message(failed, 'could not rename this'))
    view.search?.movedAll(went)
    await view.reload()
    return
  }
  const crosses = crossing(moving)
  const done: { from: string; to: string }[] = []
  const staged: { from: string; at: string; name: string }[] = []
  try {
    for (const [index, { from, name }] of moving.entries()) {
      const at = crosses ? await renameTo(from, `.orden-renaming-${index}`) : from
      staged.push({ from, at, name })
    }
    for (const { from, at, name } of staged) done.push({ from, to: await renameTo(at, name) })
  } catch (error) {
    if (crosses) await putBack(staged, done.splice(0))
    view.tell(message(error, 'could not rename this'))
  }
  record(done.length ? [{ op: 'moved', pairs: done }] : [])
  view.search?.movedAll(done)
  await view.reload()
}
