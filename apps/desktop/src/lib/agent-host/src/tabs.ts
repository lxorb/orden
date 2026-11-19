import {
  type AgentAnswer,
  agentTabKindLoaded,
  agentTabKindParts,
  portOf,
  tabKindLoaded,
  webPages,
  type SettingsSectionId,
} from '@orden/contracts'
import { documentOf } from '@orden/editor'
import { readable, seen } from './guarded'
import { noteBehind, protection } from '../../protect/src/api'
import { folderOf, nameOf, relativeTo, within } from '../../platform/src/api'
import { isOnlineTab } from '../../online-terms/src/api'
import { views } from '../../panes/src/api'
import { isWebAddress } from '@orden/scan/web-address'
import { hostOf } from '@orden/scan/visits'
import { agentMarks } from '../../workspace/src/api'
import { apartOf } from '@orden/scan/shortcut'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { fileNamed, isDraft, isUnsaved } from '../../documents/src/api'
import { TAB_KINDS } from '../../tab-kinds/src/api'
import { ACTIVE_FOR, type ReaderTab } from '../../agent-protocol/src/api'
import { TYPING } from '../../agent-docs/src/api'
import {
  asked,
  asksFront,
  type Call,
  done,
  maybe,
  need,
  needScope,
  text,
  writerOf,
  Refused,
  docSource,
  judged,
  judgedForWriting,
  onDisk,
  type Place,
  placeFor,
  placeOf,
  reachable,
  sharedSource,
  tabsInReach,
  writableAt,
  tabWithId,
} from '../../agent-verbs/src/api'
import * as view from './reader-view'
import { entryIn, moveFile } from './tree'
import { notes } from './docs'

const LONGEST_SELECTION = 20_000
const NEW_KINDS = ['note', 'canvas', 'pages', 'web', 'terminal', 'online'] as const
type NewKind = (typeof NEW_KINDS)[number]
function front(tab: Tab): boolean {
  return workspace.showing(tab.paneId)?.id === tab.id
}
const shut = (tab: Tab) => noteBehind(tab) !== null && !protection.agentsMay(noteBehind(tab))
function addressOf(tab: Tab): string | null {
  if (tab.kind !== 'web' || shut(tab)) return null
  return webPages().addressOf(tab.id) ?? workspace.webAddressOf(tab)
}
function tabOf(tab: Tab) {
  const root = workspace.activeSpace?.root
  const url = addressOf(tab)
  const outside = tab.path !== null && workspace.outside(tab.path)
  return {
    id: tab.id,
    kind: tab.kind,
    title: tab.shown,
    ...(tab.path !== null && root && !outside && within(root, tab.path) !== null
      ? { path: relativeTo(root, tab.path) }
      : {}),
    ...(url ? { url } : {}),
    pane: tab.paneId,
    front: front(tab),
    selected: tab.id === workspace.activeTabId,
    ...(isDraft(tab.note) ? { unsaved: true } : {}),
    ...(workspace.previewTabId === tab.id ? { preview: true } : {}),
    ...(tab.note.shared !== null ? { shared: true } : {}),
    ...(tab.kind === 'terminal' ? { running: agentTabKindParts('terminal').running?.(tab.id) ?? false } : {}),
    ...(isOnlineTab(tab) ? { online: true } : {}),
  }
}
function inNote(tab: Tab) {
  const view = views.of(tab.paneId)
  if (!view || documentOf(view) !== tab.note.live) return null
  const { state } = view
  const { from, to, head } = state.selection.main
  const caret = state.doc.lineAt(head)
  const shown = view.visibleRanges
  const selected = state.sliceDoc(from, Math.min(to, from + LONGEST_SELECTION))
  return {
    from,
    to,
    selected,
    ...(to - from > LONGEST_SELECTION ? { truncated: true } : {}),
    caret: { line: caret.number - 1, column: head - caret.from },
    visible: {
      from: state.doc.lineAt(shown[0]?.from ?? 0).number - 1,
      to: state.doc.lineAt(shown.at(-1)?.to ?? state.doc.length).number - 1,
    },
  }
}
async function selectionIn(tab: Tab): Promise<unknown> {
  if (tab.path !== null && !seen(tab.path)) return null
  switch (TAB_KINDS[tab.kind].selection) {
    case 'words':
      return inNote(tab)
    case 'drawing': {
      const { CanvasStore } = await import('../../canvas/src/api')
      const drawn = CanvasStore.drawing(tab.note, workspace.tabs)
      return drawn ? { picked: drawn.picked } : null
    }
    case 'terminal':
      return (await agentTabKindLoaded('terminal')).selection?.(tab.id, LONGEST_SELECTION) ?? null
    case 'page':
      return tab.page === undefined ? null : { page: tab.page }
    case null:
      return null
  }
}
async function terminalsKnown(): Promise<void> {
  if (workspace.tabs.some((one) => one.kind === 'terminal')) await agentTabKindLoaded('terminal')
}
export async function getContext(call: Call): Promise<AgentAnswer> {
  await terminalsKnown()
  const place = placeOf(call)
  const open = workspace.activeSpace
  if (open?.id !== place.space.id && !reachable(call).some((one) => one.id === open?.id)) {
    const nothing = { space: place.space.name, selected: null, selection: null, tabs: [] }
    return done({ ...nothing, typing: false }, sharedSource(place))
  }
  const front = placeFor(call, null)
  const away = place.space.id !== front.space.id
  const rowOf = (one: Tab) => (away ? { ...tabOf(one), space: front.space.name } : tabOf(one))
  const tab = workspace.active
  const last = tab?.note.live.readerAt ?? null
  const named = namedOutside(call)
  const context = {
    space: place.space.name,
    selected: tab ? rowOf(tab) : null,
    selection: tab ? await selectionIn(tab) : null,
    tabs: tabsInReach(call).map(rowOf),
    typing: last !== null && Date.now() - last < TYPING,
  }
  const outside = tab?.kind === 'terminal' ? 'tab titles and terminal output' : named ? 'tab titles' : null
  return done(context, (tab ? sourceOfTab(tab) : null) ?? sharedSource(place) ?? sharedSource(front) ?? outside)
}
function namedOutside(call: Call): boolean {
  return tabsInReach(call).some((one) => TAB_KINDS[one.kind].outsideTitle)
}
function tabsAnswer(call: Call): AgentAnswer {
  return done(tabsInReach(call).map(tabOf), namedOutside(call) ? 'tab titles' : null)
}
function tabNamed(call: Call): Tab {
  return tabWithId(call, need(call, 'tab'))
}
function answered(tab: Tab | null | undefined, place?: Place): AgentAnswer {
  return done(tab ? tabOf(tab) : null, (tab ? sourceOfTab(tab) : null) ?? (place ? sharedSource(place) : null))
}
function sourceOfTab(tab: Tab): string | null {
  return docSource({ path: tab.path, shared: tab.note.shared })
}
function keptSite(call: Call, url: string): string | null {
  const host = hostOf(url)?.replace(/\.+$/, '')
  const sites = call.caller.agent?.sites ?? {}
  if (!host) return null
  const covering = Object.keys(sites)
    .map((site) => ({ site, bare: siteNamed(site) }))
    .filter(({ bare }) => bare !== '' && (host === bare || host.endsWith(`.${bare}`)))
    .sort((one, other) => other.bare.length - one.bare.length)[0]
  if (!covering) return null
  const rule = sites[covering.site]
  return rule === 'deny' || rule === 'agent-store' ? covering.bare : null
}
function siteNamed(site: string): string {
  const bare = site.trim().replace(/^\*\./, '').replace(/\.+$/, '')
  return (hostOf(`http://${bare}/`) ?? bare).replace(/\.+$/, '').toLowerCase()
}
function webOf(call: Call, url: string): string {
  if (!isWebAddress(url)) throw new Refused('bad_arguments', `${url} is not a web address`)
  const kept = keptSite(call, url)
  if (kept) throw new Refused('site_denied', `${kept} is a site this agent may not open here`)
  return url
}
function openPage(call: Call, url: string): AgentAnswer {
  return answered(view.openPage(call, webOf(call, url)))
}
const SECTIONS: readonly SettingsSectionId[] = [
  'general',
  'editor',
  'shortcuts',
  'spelling',
  'markdown',
  'appearance',
  'ai',
  'agents',
  'sync',
  'export',
]
function showSettings(call: Call): AgentAnswer {
  const asked = maybe(call, 'section') ?? 'general'
  const section = SECTIONS.find((one) => one === asked)
  if (!section) throw new Refused('bad_arguments', `section is one of ${SECTIONS.join(', ')}`)
  view.showSettings(call, section)
  return done({ settings: section })
}
async function openSomething(call: Call): Promise<AgentAnswer> {
  const url = maybe(call, 'url')
  if (url !== null) return openPage(call, url)
  const shown = maybe(call, 'view')
  if (shown === 'graph') return answered(view.showGraph(call))
  if (shown === 'scratchpad') return view.showScratchpad(call)
  if (shown === 'settings') return showSettings(call)
  if (shown !== null) throw new Refused('bad_arguments', 'view is graph, scratchpad or settings')
  const place = placeOf(call)
  const relative = judged(need(call, 'path'))
  const path = onDisk(place, relative)
  if (!place.open) needScope(call, 'workspace.focus', 'another space')
  if (!(await entryIn(place, relative))) {
    throw new Refused('no_such_file', `there is nothing at ${relative}`)
  }
  const tab = place.open ? await view.openFile(call, path) : await view.openInSpace(call, place.space.id, path)
  return answered(tab, place)
}
function newKindOf(call: Call): NewKind {
  const kind = maybe(call, 'kind') ?? 'note'
  const found = NEW_KINDS.find((one) => one === kind)
  if (!found) throw new Refused('bad_arguments', `kind is one of ${NEW_KINDS.join(', ')}`)
  return found
}
async function newTab(call: Call): Promise<AgentAnswer> {
  const kind = newKindOf(call)
  placeFor(call, null)
  asksFront(call, 'a new tab in front')
  const question = await asked(call, null, `A new ${kind} tab`)
  if (question) return question
  switch (kind) {
    case 'web': {
      const url = maybe(call, 'url')
      if (url === null) throw new Refused('bad_arguments', 'a web tab says its url')
      return openPage(call, url)
    }
    case 'terminal':
    case 'online': {
      const open = (await agentTabKindLoaded(kind)).open
      if (!open) throw new Refused('unsupported_on_this_engine', `there are no ${kind} tabs here`)
      const id = await open(call.args, call.caller)
      return answered(workspace.tabs.find((one) => one.id === id))
    }
    case 'canvas': {
      const { blankCanvas } = await import('@orden/markdown/canvas')
      return answered(view.openUnsaved(call, 'canvas', blankCanvas()))
    }
    case 'pages': {
      const { blankPages } = await import('@orden/markdown/pages')
      const { modes } = await import('../../modes/src/api')
      return answered(view.openUnsaved(call, 'pages', blankPages(modes.pagesPaper)))
    }
    case 'note': {
      const made = view.openUnsaved(call, 'note', '')
      const words = text(call, 'content')
      if (words) await notes.writeNote(writerOf(call), { path: '', tab: made.id }, words)
      return answered(made)
    }
  }
}
async function renameTab(call: Call): Promise<AgentAnswer> {
  const tab = tabNamed(call)
  const name = need(call, 'name').trim()
  if (!name || /[\\/]/.test(name)) throw new Refused('bad_arguments', 'a name is one step, no slash')
  const place = placeFor(call, null)
  if (tab.path !== null && !workspace.outside(tab.path)) {
    const relative = relativeTo(place.space.root, tab.path)
    const folder = folderOf(relative)
    const to = folder ? `${folder}/${name}` : name
    return moveFile({ ...call, args: { path: relative, to, space: place.space.id } })
  }
  if (!isDraft(tab.note) && tab.kind !== 'terminal') {
    throw new Refused('by_hand', `tab ${tab.id} is a ${tab.kind} tab, named by what it shows`)
  }
  const question = await asked(call, null, `Rename ${tab.shown} to ${name}`)
  if (question) return question
  if (tab.kind === 'terminal') {
    await (await tabKindLoaded('terminal')).rename?.(tab.id, name)
  } else {
    tab.note.name = name
    workspace.scheduleSession()
  }
  return answered(tab)
}
async function saveTab(call: Call): Promise<AgentAnswer> {
  const tab = tabNamed(call)
  if (!isUnsaved(tab.note)) throw new Refused('exists', `tab ${tab.id} has a file already`)
  const behind = noteBehind(tab)
  if (behind !== null) readable(behind, tab.shown)
  const place = placeFor(call, null)
  const relative = judgedForWriting(need(call, 'path'))
  const folder = folderOf(relative)
  const file = fileNamed(nameOf(relative), tab.kind)
  writableAt(place, onDisk(place, relative))
  const question = await asked(call, null, `Save ${tab.shown} as ${relative}`)
  if (question) return question
  const saved = await workspace.save(tab, folder ? onDisk(place, folder) : place.space.root, file)
  if (saved === null) throw new Refused('failed', `tab ${tab.id} could not be saved`)
  return done({ ...tabOf(tab), path: relativeTo(place.space.root, saved) })
}
export async function workspaceTabs(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  placeFor(call, null)
  await terminalsKnown()
  switch (op) {
    case 'list':
      if (maybe(call, 'kind') === 'online' || maybe(call, 'kind') === 'terminal') {
        const kind = maybe(call, 'kind') ?? ''
        const list = (await agentTabKindLoaded(kind)).list
        if (!list) throw new Refused('unsupported_on_this_engine', `there are no ${kind} tabs here`)
        return list(call.args, call.caller)
      }
      return tabsAnswer(call)
    case 'open':
      return openSomething(call)
    case 'new':
      return newTab(call)
    case 'rename':
      return renameTab(call)
    case 'save':
      return saveTab(call)
    case 'close': {
      const tab = tabNamed(call)
      if (front(tab)) needScope(call, 'workspace.focus', 'closing a tab the reader can see')
      workspace.close(tab.id)
      return done({ closed: tab.id })
    }
    case 'split': {
      view.splitBeside(call, tabNamed(call))
      return tabsAnswer(call)
    }
    case 'focus': {
      const tab = tabNamed(call)
      view.showTab(call, tab)
      return answered(tab)
    }
    case 'move': {
      const tab = tabNamed(call)
      const pane = view.paneFor(tab, maybe(call, 'pane'), maybe(call, 'toward'))
      if (pane === null) {
        throw new Refused('bad_arguments', 'say pane, a pane id from list, or toward: left, right, up or down')
      }
      const at = 'at' in call.args ? Number(call.args.at) : null
      view.moveTabTo(call, tab, pane, at !== null && Number.isInteger(at) && at >= 0 ? at : null)
      return tabsAnswer(call)
    }
    case 'arrange': {
      const named = maybe(call, 'tab') === null ? null : tabNamed(call)
      view.arrangePanes(call, need(call, 'layout'), named)
      return tabsAnswer(call)
    }
    default:
      throw new Refused(
        'bad_arguments',
        'op is one of list, open, new, rename, save, close, split, focus, move, arrange',
      )
  }
}
export function readerTabs(): ReaderTab[] {
  return workspace.tabs
    .filter((tab) => tab.kind === 'web' && !shut(tab))
    .map((tab) => {
      const shown = workspace.panes.at(tab.paneId) !== null && front(tab)
      const home = workspace.spaceOf(tab.note)
      const space = workspace.spaces.find((one) => one.id === home)?.name
      return {
        id: tab.id,
        title: tab.shown,
        url: addressOf(tab) ?? '',
        ...(space ? { space } : {}),
        front: shown && tab.paneId === workspace.panes.focusedId,
        on_screen: shown,
      }
    })
}
const LENT_UNMARKED = ACTIVE_FOR + 5_000
export async function lendTab(id: string): Promise<null> {
  const tab = workspace.tabs.find((one) => one.id === id && one.kind === 'web')
  if (!tab || shut(tab)) return null
  const lending = portOf('web.lending')
  if (!lending.ok) return null
  await lending.value.lend(tab.id, {
    url: tab.address ?? workspace.webAddressOf(tab),
    space: workspace.spaceOf(tab.note),
    path: tab.path,
    own: apartOf(tab),
  })
  setTimeout(() => {
    if (!(tab.id in agentMarks.on)) lending.value.unlend(tab.id)
  }, LENT_UNMARKED)
  return null
}
