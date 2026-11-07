import { message, plural, t } from '../i18n.svelte'
import type { Picked as Brought } from '../import/sources'
import { fileClipboard } from '../list-landing.svelte'
import { prompt } from '../prompt.svelte'
import { nameOf } from '../space-paths'
import { invoke, joinPath } from '../tauri'
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
import { jobs } from './jobs.svelte'
import { inASpace } from './open'
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

export function freeName(taken: readonly string[], name: string): string {
  const names = new Set(taken.map((one) => one.toLowerCase()))
  if (!names.has(name.toLowerCase())) return name
  for (let count = 2; ; count++) {
    const next = `${name} ${count}`
    if (!names.has(next.toLowerCase())) return next
  }
}

export async function newFolder(view: ExplorerView) {
  const folder = view.listing?.path
  if (!folder || !changeable(view)) return
  try {
    let path: string
    if (inASpace(folder)) {
      path = joinPath(folder, freeName(view.names, t('New folder')))
      await invoke('create_folder', { path })
      await workspace.loadTree()
    } else {
      path = await makeIn(folder, t('New folder'), false)
      record([{ op: 'made', path }])
    }
    await view.reload()
    view.pick(nameOf(path), 'one')
    view.renaming = nameOf(path)
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
      to = joinPath(view.listing?.path ?? '', clean)
    } else {
      to = await renameTo(from, clean)
      record([{ op: 'moved', pairs: [{ from, to }] }])
    }
    await view.reload()
    view.pick(nameOf(to), 'one')
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
    title: plural(outside.length, {
      one: 'Delete {count} item for good?',
      other: 'Delete {count} items for good?',
    }),
    detail: t('This cannot be undone.'),
    confirmLabel: t('Delete for good'),
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

export async function paste(view: ExplorerView) {
  const folder = view.listing?.path
  const paths = [...fileClipboard.paths]
  if (!folder || !paths.length || !changeable(view)) return
  const cut = fileClipboard.cut
  if (cut) fileClipboard.hold([], false)
  await carry(view, paths, folder, cut ? 'move' : 'copy')
}

export async function duplicate(view: ExplorerView, paths: readonly string[]) {
  const folder = view.listing?.path
  if (folder && paths.length && changeable(view)) await carry(view, paths, folder, 'copy')
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
    if (outside.length) await across(outside, folder, how, clash, tell)
    if (inside.length) {
      const done = await across(inside, folder, 'copy', clash, tell)
      if (how === 'move' && done.length) await workspace.removeMany(done)
    }
  })
  await view?.reload()
}

async function across(
  sources: readonly string[],
  folder: string,
  how: 'copy' | 'move',
  clash: Clash,
  tell: (said: string) => void,
): Promise<string[]> {
  const label =
    how === 'move'
      ? plural(sources.length, { one: 'Moving {count} item', other: 'Moving {count} items' })
      : plural(sources.length, { one: 'Copying {count} item', other: 'Copying {count} items' })
  let done: Transferred
  try {
    done = await jobs.run(label, (id) => transfer(id, sources, folder, how, clash))
  } catch (error) {
    tell(message(error, 'could not copy this'))
    return []
  }
  const steps: OutsideStep[] = []
  if (done.replaced.length) steps.push({ op: 'replaced', tickets: done.replaced })
  if (done.done.length) steps.push({ op: how === 'move' ? 'moved' : 'copied', pairs: done.done })
  record(steps)
  const [failed] = done.failed
  if (failed) tell(`${nameOf(failed.path)}: ${failed.why}`)
  return done.done.map((one) => one.from)
}

async function clashFor(sources: readonly string[], folder: string): Promise<Clash | null> {
  const names = await clashesIn(sources, folder).catch(() => [])
  if (!names.length) return 'keep'
  const [only, ...more] = names
  const answer = await prompt.choose({
    title:
      only !== undefined && !more.length
        ? t('{name} is already here', { name: only })
        : plural(names.length, {
            one: '{count} name is already here',
            other: '{count} names are already here',
          }),
    options: [
      { id: 'keep', label: t('Keep both'), lands: true },
      { id: 'replace', label: t('Replace'), danger: true },
      { id: 'skip', label: t('Skip') },
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
      if (read.cut) throw new Error(t('This file is too large to bring into a space.'))
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
    try {
      await workspace.undone.batch(async () => {
        for (const { from, name } of moving) await workspace.rename(from, name)
      })
    } catch (error) {
      view.tell(message(error, 'could not rename this'))
    }
    await view.reload()
    return
  }
  const crossing = moving.some(({ name }, at) =>
    moving.some(
      (other, there) => there !== at && nameOf(other.from).toLowerCase() === name.toLowerCase(),
    ),
  )
  const done: { from: string; to: string }[] = []
  const staged: { from: string; at: string; name: string }[] = []
  try {
    for (const [index, { from, name }] of moving.entries()) {
      const at = crossing ? await renameTo(from, `.orden-renaming-${index}`) : from
      staged.push({ from, at, name })
    }
    for (const { from, at, name } of staged) done.push({ from, to: await renameTo(at, name) })
  } catch (error) {
    if (crossing) await putBack(staged, done.splice(0))
    view.tell(message(error, 'could not rename this'))
  }
  record(done.length ? [{ op: 'moved', pairs: done }] : [])
  await view.reload()
}
