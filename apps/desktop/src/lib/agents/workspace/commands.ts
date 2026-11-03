/** One row of the palette: `run_command` (docs/agent-native.md 5.4).
 *
 *  The registry's own row, run the way `nib commands run` runs it (automation/acts.ts):
 *  a row greyed out is refused, a row only the window's hands may press (`ownWindow`:
 *  a shell) is refused, and so is a row only somebody at the keyboard may press
 *  (`byHand`: the microphone, the camera, signing out), which a link cannot press
 *  either. Past those, three kinds of row are more than an agent's to press alone:
 *
 *  - the rows that put words where somebody else can read them - sharing a space or a
 *    note, publishing a blog - ask the reader first (9.3, publishing and sharing);
 *  - the rows that change a setting ask the same way `write_setting` does (9.3);
 *  - the rows that take the reader somewhere else - another space, another window, a
 *    presentation - move what they are looking at, and need `workspace.focus` (7.2),
 *    with the window itself never an agent's to open, close or quit;
 *
 *  - and past those a row needs what the verb behind it needs (`scopeOf`): a row that
 *    closes a tab the reader can see what `workspace_tabs close` needs, one that rewrites
 *    a note `notes.write`. A row this list does not know is the reader's to press, so a
 *    row added to the palette is not an agent's until somebody says which it is. */

import { appCommands, type Command } from '../../commands'
import type { AgentAnswer } from '../../automation/caller'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import type { Category, Scope } from '../verbs'
import { asked, readersOwn } from './asks'
import { type Call, done, need, needScope } from './call'
import { Refused } from './problem'
import { placeFor } from './spaces'

/** What asks, by the row's id. */
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

/** The rows about the window itself, which no agent opens, closes, updates or quits. */
const WINDOW = new Set(['new-window', 'close-window', 'update', 'logs', 'themes-folder'])

/** The rows that take the reader somewhere or change what is on their screen, as
 *  `workspace_tabs` asks of the same acts (7.2). */
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
  'new-canvas',
  'new-database',
  'new-from-template',
  'new-pages',
  'new-space',
  'new-unique',
  'new-web-note',
  'new-website',
  'next-slide',
  'pin',
  'present',
  'previous-slide',
  'print',
  'random-note',
  'reading',
  'region-next',
  'region-previous',
  'reopen',
  'save-layout',
  'settings',
  'shortcuts',
  'space',
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

/** The rows that write in the note in front. */
const WRITES = new Set([
  'ai-block',
  'convert-syntax',
  'extract-selection',
  'merge-into',
  'new-slide',
  'page-break',
  'picture',
  'reformat',
  'save',
  'slide-break',
  'split-at-caret',
])

/** The rows that move, make or take back files. */
const TREE = new Set([
  'archive',
  'convert-website-notes',
  'move-note',
  'move-to-space',
  'redo-file',
  'rename',
  'undo-file',
])

/** The rows that only show or hide a panel beside what the reader is reading. */
const PANELS = new Set([
  'ask-panel',
  'files',
  'fold-list',
  'footnotes-panel',
  'hold-panel',
  'links-panel',
  'outline-panel',
  'properties-panel',
  'quick-question',
  'reveal',
  'right-sidebar',
  'scratchpad',
  'search-space',
  'sidebar',
])

/** The scope a row needs, or null for a row that is the reader's to press: every row
 *  not named here. */
function scopeOf(id: string): Scope | null {
  if (ASKS[id] || asksOfSetting(id) || PANELS.has(id) || id.startsWith('view.')) return 'workspace'
  if (SCREEN.has(id) || id.startsWith('space:') || id.startsWith('layout:')) {
    return 'workspace.focus'
  }
  if (TREE.has(id)) return 'tree'
  if (WRITES.has(id) || /^(edit|format|paragraph)\./.test(id)) return 'notes.write'
  return null
}

/** The rows of a setting named by what it is set to: they ask as `write_setting` does. */
function asksOfSetting(id: string): boolean {
  return /^(theme|scheme|accent|properties|code-theme):/.test(id) || id === 'read-only'
}

export async function runCommand(call: Call): Promise<AgentAnswer> {
  // The palette's rows are the space in the window's; an agent that may not reach it
  // has no business pressing them.
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
  const scope = scopeOf(id)
  if (scope === null) readersOwn(call, `${id} is the reader's to press`)
  else needScope(call, scope, id)

  const category = ASKS[id] ?? (asksOfSetting(id) ? 'settings' : null)
  const question = await asked(call, category, found.label)
  if (question) return question

  found.run()
  return done({ id, label: found.label })
}
