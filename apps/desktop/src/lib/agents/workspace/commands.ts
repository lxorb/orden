import { appCommands, type Command } from '../../commands'
import { invoke } from '../../platform/src/api'
import type { AgentAnswer } from '../../automation/caller'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import type { Category, Scope } from '../verbs'
import { asked, answered, readersOwn } from './asks'
import { type Call, done, maybe, need, needScope } from './call'
import { Refused } from './problem'
import { placeFor } from './spaces'

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
  'keys',
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

const MAKES_SPACE = new Set(['new-space', 'space'])

const WRITES = new Set([
  'ai-block',
  'convert-syntax',
  'extract-selection',
  'merge-into',
  'page-break',
  'picture',
  'reformat',
  'save',
  'split-at-caret',
])

const TREE = new Set([
  'archive',
  'convert-website-notes',
  'move-note',
  'move-to-space',
  'redo-file',
  'rename',
  'undo-file',
])

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
  if (TREE.has(id)) return ['tree']
  if (WRITES.has(id) || /^(edit|format|paragraph)\./.test(id)) return ['notes.write']
  return null
}

function opensADialog(id: string): boolean {
  return id.startsWith('export-') || id === 'import'
}

function asksOfSetting(id: string): boolean {
  return /^(theme|scheme|accent|properties|code-theme):/.test(id) || id === 'read-only'
}

export async function runCommand(call: Call): Promise<AgentAnswer> {
  placeFor(call, null)

  const id = need(call, 'id')
  const found: Command | undefined = appCommands(views.of(workspace.panes.focusedId)).find(
    (one) => one.id === id,
  )
  if (!found) throw new Refused('no_such_command', `there is no command called ${id}`)
  if (found.disabled === true) throw new Refused('failed', `${id} cannot run just now`)
  if (found.ownWindow === true || found.byHand === true || WINDOW.has(id)) {
    readersOwn(call, `${id} is the reader's to press`)
  }
  const path = maybe(call, 'path')
  const scopes = path !== null && opensADialog(id) ? [] : scopesOf(id)
  if (scopes === null) readersOwn(call, `${id} is the reader's to press`)
  for (const scope of scopes ?? []) needScope(call, scope, id)

  const category = ASKS[id] ?? (asksOfSetting(id) ? 'settings' : null)
  const question = await asked(call, category, found.label)
  if (question) return question

  if (path === null) {
    found.run()
    return done({ id, label: found.label })
  }
  return withPath(call, found, path)
}

const DIALOG_WITHIN = 15_000

async function withPath(call: Call, found: Command, path: string): Promise<AgentAnswer> {
  const { answerNextDialog } = await import('../../dialog-answer')
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
