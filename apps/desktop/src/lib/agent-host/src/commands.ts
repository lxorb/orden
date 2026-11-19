import { commandRowsLoaded } from '@orden/contracts'
import { appCommands, type Command } from '../../commands/src/api'
import { invoke, answerNextDialog, relativeTo } from '../../platform/src/api'
import { type AgentAnswer, keptFromAgents, NOTE_TREE, NOTE_WRITES } from '../../automation/src/api'
import { readable, readableAll, seen } from './guarded'
import { protection } from '../../protect/src/api'
import { views } from '../../panes/src/api'
import { nothingLockedWaits } from './deleted'
import { workspace } from '../../workspace/src/api'
import type { AgentScope as Scope } from '@orden/contracts'
import type { Category } from '../../agent-protocol/src/api'
import {
  asked,
  answered,
  readersOwn,
  type Call,
  done,
  maybe,
  need,
  needScope,
  Refused,
  placeFor,
} from '../../agent-verbs/src/api'

const ASKS: Record<string, Category> = {
  share: 'publishing',
  'share-note': 'publishing',
  publish: 'publishing',
  'window-frame': 'settings',
  'custom-css': 'settings',
  snippets: 'settings',
  source: 'settings',
  focus: 'settings',
  typewriter: 'settings',
  punctuation: 'settings',
  numbers: 'settings',
  'line-numbers': 'settings',
  rtl: 'settings',
  strict: 'settings',
  'equation-numbers': 'settings',
  wider: 'settings',
  narrower: 'settings',
  looser: 'settings',
  tighter: 'settings',
  'zoom-in': 'settings',
  'zoom-out': 'settings',
  'zoom-reset': 'settings',
}

const WINDOW = new Set(['new-window', 'close-window', 'update', 'logs', 'themes-folder'])

const SCREEN = new Set([
  'agents-panel',
  'always-on-top',
  'back',
  'close',
  'close-all',
  'close-pane',
  'close-right',
  'delete-layout',
  'deselect-all',
  'deselect-tab',
  'duplicate-tab',
  'focus-pane',
  'forward',
  'full-window',
  'fullscreen',
  'graph',
  'history',
  'move-tab-pane',
  'new',
  'new-website',
  'pin',
  'print',
  'random-note',
  'reading',
  'region-next',
  'region-previous',
  'reopen',
  'save-layout',
  'settings',
  'shortcuts',
  'space-next',
  'space-previous',
  'spaces',
  'split-down',
  'split-right',
  'stack-tabs',
  'tab-overview',
  'themes',
  'web-back',
  'web-find',
  'web-forward',
  'web-history',
  'web-reload',
  'web-stop',
])

const MAKES_NOTE = new Set([
  'new-canvas',
  'new-database',
  'new-from-template',
  'new-pages',
  'new-unique',
  'new-web-note',
])

const MAKES_SPACE = new Set(['space'])

const PANELS = new Set([
  'ask-panel',
  'files',
  'fold-list',
  'footnotes-panel',
  'hold-panel',
  'links-panel',
  'outline-panel',
  'quick-question',
  'reveal',
  'right-sidebar',
  'scratchpad',
  'search-space',
  'sidebar',
])

function scopesOf(id: string): readonly Scope[] | null {
  if (ASKS[id] || asksOfSetting(id) || PANELS.has(id) || id.startsWith('view.')) {
    return ['workspace']
  }
  if (MAKES_NOTE.has(id)) return ['notes.write', 'workspace.focus']
  if (MAKES_SPACE.has(id)) return ['tree', 'workspace.focus']
  if (SCREEN.has(id) || id.startsWith('space:') || id.startsWith('layout:')) {
    return ['workspace.focus']
  }
  if (NOTE_TREE.has(id)) return ['tree']
  if (NOTE_WRITES.has(id) || /^(edit|format|paragraph)\./.test(id)) return ['notes.write']
  return null
}

function opensADialog(id: string): boolean {
  return id.startsWith('export-') || id === 'import'
}

function asksOfSetting(id: string): boolean {
  return /^(theme|scheme|accent|properties|code-theme):/.test(id) || id === 'read-only'
}

function exportsOnlyWhatAgentsMay(id: string): void {
  const space = workspace.activeSpace
  const front = workspace.active?.path
  if (id !== 'export-space' && front) {
    readable(front, space ? relativeTo(space.root, front) : front)
  }
  for (const one of workspace.spaces) readableAll(one.root, one.name)
}

export async function runCommand(call: Call): Promise<AgentAnswer> {
  placeFor(call, null)

  const id = need(call, 'id')
  await commandRowsLoaded()
  const found: Command | undefined = appCommands(views.of(workspace.panes.focusedId)).find((one) => one.id === id)
  if (!found) throw new Refused('no_such_command', `there is no command called ${id}`)
  if (found.disabled === true) throw new Refused('failed', `${id} cannot run just now`)
  if (id.startsWith('protect.')) {
    throw new Refused('by_hand', `${id} is the reader's to press, whatever the agent may do`)
  }
  const kept = keptFromAgents(id, {
    front: seen(workspace.active?.path ?? ''),
    space: protection.agentsMayAllOf(workspace.activeSpace?.root ?? ''),
    everywhere: protection.agentsMayAllOf(),
  })
  if (kept) throw new Refused('protected', kept)
  if (found.ownWindow === true || found.byHand === true || WINDOW.has(id)) {
    readersOwn(call, `${id} is the reader's to press`)
  }
  const path = maybe(call, 'path')
  if (id.startsWith('export-')) exportsOnlyWhatAgentsMay(id)
  const scopes = path !== null && opensADialog(id) ? [] : scopesOf(id)
  if (scopes === null) readersOwn(call, `${id} is the reader's to press`)
  for (const scope of scopes ?? []) needScope(call, scope, id)

  reachesNothingShut(id, scopes ?? [])
  if (id === 'undo-file' || id === 'redo-file') {
    const agent = call.caller.agent
    if (agent !== null && agent.spaces !== 'all') {
      throw new Refused('no_such_space', `${id} reaches every space, and you reach only some`)
    }
    await nothingLockedWaits(null)
  }

  const category = ASKS[id] ?? (asksOfSetting(id) ? 'settings' : null)
  const question = await asked(call, category, found.label)
  if (question) return question

  if (path === null) {
    found.run()
    return done({ id, label: found.label })
  }
  return withPath(call, found, path)
}

function reachesNothingShut(id: string, scopes: readonly Scope[]): void {
  const note = workspace.active?.path
  const touches = id.startsWith('export-') || scopes.includes('notes.write')
  if (note && touches) readable(note, 'The note in front')
}

const DIALOG_WITHIN = 15_000

async function withPath(call: Call, found: Command, path: string): Promise<AgentAnswer> {
  const agent = call.caller.agent
  let settle: (said: AgentAnswer | null) => void = () => undefined
  const judged = new Promise<AgentAnswer | null>((go) => (settle = go))
  answerNextDialog(async (write) => {
    if (agent === null) {
      settle(null)
      return path
    }
    const said = await invoke<unknown>('agents_dialog_path', {
      agent: agent.id,
      path,
      write,
    }).catch((error: unknown) => ({ status: 'error', code: 'failed', message: String(error) }))
    const refused = answered(said)
    settle(refused)
    if (refused !== null) return null
    const result = (said as { result?: { path?: unknown } }).result
    return typeof result?.path === 'string' ? result.path : null
  })

  found.run()
  const over = new Promise<'unused'>((go) => setTimeout(() => go('unused'), DIALOG_WITHIN))
  const outcome = await Promise.race([judged, over])
  answerNextDialog(null)
  if (outcome === 'unused') return done({ id: found.id, label: found.label, path_unused: true })
  return outcome ?? done({ id: found.id, label: found.label, path })
}
