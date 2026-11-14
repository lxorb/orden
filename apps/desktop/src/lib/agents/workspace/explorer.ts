import type { AgentAnswer } from '../../automation/caller'
import { message } from '../../ui-kit/src/api'
import { foldsIn, pathKeyAs, samePath, joinPath } from '../../platform/src/api'
import type { Tab } from '../../workspace.svelte'
import { workspace } from '../../workspace.svelte'
import type { Category } from '../verbs'
import { asked } from './asks'
import { type Call, done, maybe, need } from './call'
import { Refused } from './problem'

type View = import('../../explorer/view.svelte').ExplorerView

const OPS = 'op is list, open, go, select, trash, move, copy, rename or mkdir'

export async function explorerTabs(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  const { viewOf } = await import('../../explorer/view.svelte')
  if (op === 'list') {
    return done(
      {
        tabs: workspace.tabs
          .filter((tab) => tab.kind === 'explorer')
          .map((tab) => listed(tab, viewOf(tab))),
      },
      'the names of files on this computer',
    )
  }
  if (op === 'open') {
    const folder = await looked(call, await absolute(need(call, 'path')))
    if (typeof folder !== 'string') return folder
    const { openExplorer } = await import('../../explorer/open')
    const tab = await openExplorer(folder, false)
    const view = viewOf(tab)
    await view.appear()
    return shown(tab, view)
  }

  const tab = explorerTab(call)
  const view = viewOf(tab)
  if (!view.listing) await view.appear()

  switch (op) {
    case 'go': {
      const folder = await looked(call, await absolute(need(call, 'path')))
      if (typeof folder !== 'string') return folder
      await view.go(folder)
      if (!view.listing || !samePath(view.listing.path, folder)) {
        throw new Refused('failed', view.wrong ?? `${folder} could not be listed`)
      }
      return shown(tab, view)
    }
    case 'select': {
      const folds = view.listing !== null && foldsIn(view.listing.path)
      view.pickNames(
        namesAt(view.rows, (name) => view.pathOf(name), await pathsOf(call, view), folds),
      )
      return shown(tab, view)
    }
    case 'trash':
    case 'move':
    case 'copy':
    case 'rename':
    case 'mkdir':
      return changed(call, op, tab, view)
    default:
      throw new Refused('bad_arguments', OPS)
  }
}

async function changed(
  call: Call,
  op: 'trash' | 'move' | 'copy' | 'rename' | 'mkdir',
  tab: Tab,
  view: View,
): Promise<AgentAnswer> {
  const changes = await import('../../explorer/changes')
  const { inASpace } = await import('../../explorer/open')
  const folder = view.listing?.path
  if (!folder || !changes.changeable(view)) {
    throw new Refused('read_only', `${folder ?? 'this tab'} takes no changes`)
  }
  const paths = op === 'mkdir' ? [] : await pathsOf(call, view)
  const to = op === 'move' || op === 'copy' ? await absolute(need(call, 'to')) : null
  if ([folder, ...paths, ...(to ? [to] : [])].some((one) => inASpace(one))) {
    throw new Refused(
      'not_granted',
      'that is in your spaces: use move_file, trash_file or create_folder, which keep links, undo and sync right',
    )
  }
  const category: Category =
    op === 'trash' ? 'trashing' : call.caller.agent?.mode === 'confirm' ? 'writing' : 'files'
  const question = await asked(call, category, summary(op, paths, to, maybe(call, 'name')), folder)
  if (question) return question

  const said: string[] = []
  const tell = view.tell.bind(view)
  view.tell = (words: string) => {
    said.push(words)
    tell(words)
  }
  try {
    if (op === 'trash') await changes.trash(view, paths)
    else if (op === 'rename') {
      const [path] = paths
      if (path === undefined || paths.length > 1)
        throw new Refused('bad_arguments', 'rename one path')
      await changes.renamePath(view, path, need(call, 'name'))
    } else if (op === 'mkdir') {
      const { makeIn } = await import('../../explorer/commands')
      const made = await makeIn(folder, need(call, 'name'), false)
      workspace.undone.record({ kind: 'outside', steps: [{ op: 'made', path: made }] })
      await view.reload()
    } else if (to) {
      const { listFolder } = await import('../../explorer/commands')
      await listFolder(to)
      await changes.carry(view, paths, to, op === 'move' ? 'move' : 'copy')
    }
  } catch (error) {
    if (error instanceof Refused) throw error
    throw new Refused('failed', error instanceof Error ? error.message : String(error))
  } finally {
    view.tell = tell
  }
  if (said.length) throw new Refused('failed', said.join('; '))
  return shown(tab, view)
}

function summary(
  op: string,
  paths: readonly string[],
  to: string | null,
  name: string | null,
): string {
  const what = paths.length === 1 ? (paths[0] ?? '') : `${paths.length} files`
  switch (op) {
    case 'trash':
      return `Move ${what} to the trash`
    case 'move':
      return `Move ${what} to ${to ?? ''}`
    case 'copy':
      return `Copy ${what} to ${to ?? ''}`
    case 'rename':
      return `Rename ${what} to ${name ?? ''}`
    default:
      return `Make the folder ${name ?? ''}`
  }
}

async function looked(call: Call, folder: string): Promise<string | AgentAnswer> {
  const { inASpace } = await import('../../explorer/open')
  const { listFolder } = await import('../../explorer/commands')
  let listing
  try {
    listing = await listFolder(folder)
  } catch (error) {
    throw new Refused('not_found', message(error, 'could not read this folder'))
  }
  if (listing.own) {
    throw new Refused(
      'not_granted',
      `${listing.path} is in Orden's own folder, with the agents' grants and the sites' cookies: no agent reaches it`,
    )
  }
  if (!inASpace(listing.path)) {
    const question = await asked(call, 'files', `Look in ${listing.path}`, listing.path)
    if (question) return question
  }
  return listing.path
}

async function absolute(asked: string): Promise<string> {
  const said = asked.trim()
  if (said === '~' || /^~[\\/]/.test(said)) {
    const { places } = await import('../../explorer/places.svelte')
    const home = await places.home()
    if (!home) throw new Refused('failed', 'this computer has no home folder')
    return said === '~' ? home : joinPath(home, said.slice(2).replace(/\\/g, '/'))
  }
  if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(said)) {
    throw new Refused(
      'bad_arguments',
      `${asked} is not an absolute path: say where it is, or start it with ~/`,
    )
  }
  return said
}

export function namesAt(
  rows: readonly { name: string }[],
  pathOf: (name: string) => string,
  paths: readonly string[],
  folds: boolean,
): string[] {
  const wanted = new Set(paths.map((one) => pathKeyAs(one, folds)))
  return rows.filter((one) => wanted.has(pathKeyAs(pathOf(one.name), folds))).map((one) => one.name)
}

const MOST_PATHS = 1000

async function pathsOf(call: Call, view: View): Promise<string[]> {
  const raw = call.args.paths ?? (call.args.path === undefined ? undefined : [call.args.path])
  if (!Array.isArray(raw) || !raw.length || !raw.every((one) => typeof one === 'string')) {
    throw new Refused(
      'bad_arguments',
      'say which, as paths: absolute, ~/, or names in the tab’s folder',
    )
  }
  if (raw.length > MOST_PATHS) {
    throw new Refused('bad_arguments', `paths is a list of up to ${MOST_PATHS} paths`)
  }
  const out: string[] = []
  for (const one of raw) {
    out.push(
      /^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(one.trim()) ? await absolute(one) : view.pathOf(one),
    )
  }
  return out
}

function explorerTab(call: Call): Tab {
  const id = need(call, 'tab')
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab) throw new Refused('no_such_tab', `there is no tab ${id}: op list names them`)
  if (tab.kind !== 'explorer') {
    throw new Refused('bad_arguments', `tab ${id} is a ${tab.kind} tab, not a file explorer`)
  }
  return tab
}

function listed(tab: Tab, view: View) {
  return {
    tab: tab.id,
    folder: view.listing?.path ?? view.folder,
    picked: view.chosen,
    view: view.search ? 'search' : 'folder',
  }
}

function shown(tab: Tab, view: View): AgentAnswer {
  return done(
    {
      ...listed(tab, view),
      entries: view.rows.slice(0, 500).map((one) => ({
        name: one.name,
        folder: one.folder,
        size: one.size,
        modified: one.modified,
      })),
      truncated: view.rows.length > 500,
    },
    `the names of files in ${view.listing?.path ?? 'a folder'}`,
  )
}
