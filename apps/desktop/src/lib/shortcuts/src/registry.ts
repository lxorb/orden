import {
  type BindingSpec,
  type EditorView,
  imageBindings,
  ordenBindings,
  standardBindings,
  tableBindings,
} from '@orden/editor'
import { type ExportId, EXPORT_KEYS, labelOf } from '../../export-formats/src/api'
import {
  paneMoves,
  refreshing,
  revealPanel,
  stepRegionFocus,
  toggleTabOverview,
  workspace,
} from '../../workspace/src/api'
import { modes } from '../../modes/src/api'
import {
  commandRows,
  commandRowsLoaded,
  searching,
  runCommand,
  settingsWindow,
  showQuickAdd,
} from '@orden/contracts'
import { chatsOn, hiddenKinds, passOn, timeOn } from '../../gates/src/api'
import { stepSpace, toggleSpacePicker } from '../../spaces/src/api'
import { closeWindow, invoke, isDesktop } from '../../platform/src/api'
import type { Platform } from '../../ui-kit/src/api'
import { type Toward, type Around, closeAfterLabel } from '../../panes/src/api'
import type { UsageVia } from '@orden/sync-core'
import { ran } from '../../usage/src/api'

let askAgain: (() => boolean) | null = null

export function hearAgain(answer: (() => boolean) | null): void {
  askAgain = answer
}

export type Category =
  | 'file'
  | 'edit'
  | 'format'
  | 'paragraph'
  | 'view'
  | 'panel'
  | 'canvas'
  | 'pages'
  | 'table'
  | 'picture'
  | 'tasks'
  | 'explorer'
  | 'pass'
  | 'fixed'

export const CATEGORIES: { id: Category; label: () => string }[] = [
  { id: 'file', label: () => 'File' },
  { id: 'edit', label: () => 'Edit' },
  { id: 'format', label: () => 'Format' },
  { id: 'paragraph', label: () => 'Paragraph' },
  { id: 'view', label: () => 'View' },
  { id: 'panel', label: () => 'File list' },
  { id: 'canvas', label: () => 'Canvas' },
  { id: 'pages', label: () => 'Pages' },
  { id: 'table', label: () => 'Tables' },
  { id: 'picture', label: () => 'Pictures' },
  { id: 'explorer', label: () => 'File explorer' },
  { id: 'pass', label: () => 'Pass' },
  { id: 'fixed', label: () => 'Fixed keys' },
]

export interface AppContext {
  view?: EditorView | undefined
  palette(mode?: 'commands', again?: boolean): void
  fullscreen(): void
  tapped?: boolean
  held?: boolean
}

export interface Shortcut {
  id: string
  label: () => string
  category: Category
  scope: 'app' | 'editor' | 'panel' | 'fixed'
  key: string | null
  mac?: string | null
  win?: string | null
  linux?: string | null
  contextual?: boolean
  alias?: boolean
  why?: () => string
  run?: (context: AppContext) => void
  desktop?: boolean
  shown?: () => boolean
}

type Extra = Partial<Omit<Shortcut, 'id' | 'label' | 'category' | 'scope' | 'key'>>
type Label = string | (() => string)

const said = (label: Label) => (typeof label === 'string' ? () => label : label)

function app(
  category: Category,
  id: string,
  label: Label,
  key: string | null,
  run: (context: AppContext) => void,
  extra: Extra = {},
): Shortcut {
  return { id, label: said(label), category, scope: 'app', key, run, ...extra }
}

function panel(
  category: Category,
  id: string,
  label: Label,
  key: string | null,
  extra: Extra = {},
): Shortcut {
  return { id, label: said(label), category, scope: 'panel', key, contextual: true, ...extra }
}

function fixed(
  id: string,
  label: string,
  key: string | null,
  why: string,
  extra: Extra = {},
): Shortcut {
  return {
    id,
    label: said(label),
    category: 'fixed',
    scope: 'fixed',
    key,
    why: said(why),
    ...extra,
  }
}

const EDITOR_ENTRIES: Record<string, [Category, string]> = {
  'format.bold': ['format', 'Bold'],
  'format.italic': ['format', 'Italic'],
  'format.underline': ['format', 'Underline'],
  'format.code': ['format', 'Code'],
  'format.strikethrough': ['format', 'Strikethrough'],
  'format.highlight': ['format', 'Highlight'],
  'format.link': ['format', 'Link'],
  'format.image': ['format', 'Image'],
  'format.clear': ['format', 'Clear formatting'],
  'format.comment': ['format', 'Comment'],

  'paragraph.body': ['paragraph', 'Paragraph'],
  'paragraph.heading-1': ['paragraph', 'Heading 1'],
  'paragraph.heading-2': ['paragraph', 'Heading 2'],
  'paragraph.heading-3': ['paragraph', 'Heading 3'],
  'paragraph.heading-4': ['paragraph', 'Heading 4'],
  'paragraph.heading-5': ['paragraph', 'Heading 5'],
  'paragraph.heading-6': ['paragraph', 'Heading 6'],
  'paragraph.heading-up': ['paragraph', 'One heading level up'],
  'paragraph.heading-down': ['paragraph', 'One heading level down'],
  'paragraph.table': ['paragraph', 'Table'],
  'paragraph.code-block': ['paragraph', 'Code block'],
  'paragraph.math-block': ['paragraph', 'Math block'],
  'paragraph.chart': ['paragraph', 'Chart'],
  'paragraph.quote': ['paragraph', 'Quote'],
  'paragraph.ordered-list': ['paragraph', 'Numbered list'],
  'paragraph.bullet-list': ['paragraph', 'Bulleted list'],
  'paragraph.rule': ['paragraph', 'Horizontal rule'],
  'paragraph.task-list': ['paragraph', 'Task list'],
  'paragraph.task': ['paragraph', 'Tick the task'],
  'paragraph.callout': ['paragraph', 'Callout'],
  'paragraph.footnote': ['paragraph', 'Footnote'],
  'paragraph.toc': ['paragraph', 'Table of contents'],

  'view.fold': ['view', 'Fold'],
  'view.fold-all': ['view', 'Fold everything'],
  'view.fold-more': ['view', 'Fold more'],
  'view.fold-less': ['view', 'Fold less'],
  'view.unfold-all': ['view', 'Unfold everything'],

  'edit.indent': ['edit', 'Indent'],
  'edit.outdent': ['edit', 'Outdent'],
  'edit.run-fence': ['edit', 'Run this code block'],
  'edit.select-word': ['edit', 'Select the word, then the next'],
  'edit.select-line': ['edit', 'Select the line'],
  'edit.select-all-occurrences': ['edit', 'Select every one like it'],
  'edit.expand-selection': ['edit', 'Expand the selection'],
  'edit.shrink-selection': ['edit', 'Shrink the selection'],
  'edit.cursor-above': ['edit', 'Add a cursor above'],
  'edit.cursor-below': ['edit', 'Add a cursor below'],
  'edit.copy-markdown': ['edit', 'Copy as markdown'],
  'edit.paste-plain': ['edit', 'Paste as plain text'],
  'edit.undo': ['edit', 'Undo'],
  'edit.redo': ['edit', 'Redo'],
  'edit.redo.alt': ['edit', 'Redo'],
  'edit.select-all': ['edit', 'Select all'],
  'edit.find': ['edit', 'Find'],
  'edit.replace': ['edit', 'Replace'],
  'edit.find-next': ['edit', 'Find next'],
  'edit.find-next.alt': ['edit', 'Find next'],
  'edit.find-previous': ['edit', 'Find previous'],
  'edit.find-previous.alt': ['edit', 'Find previous'],
  'edit.goto-line': ['edit', 'Go to line'],
  'edit.move-line-up': ['edit', 'Move the line up'],
  'edit.move-line-down': ['edit', 'Move the line down'],
  'edit.copy-line-up': ['edit', 'Copy the line up'],
  'edit.copy-line-down': ['edit', 'Copy the line down'],
  'edit.insert-line-above': ['edit', 'Insert a line above'],
  'edit.delete-line': ['edit', 'Delete the line'],
  'edit.join-lines': ['edit', 'Join the lines'],
  'edit.sort-lines': ['edit', 'Sort the lines'],
  'edit.reverse-lines': ['edit', 'Reverse the lines'],
  'edit.upper-case': ['edit', 'Upper case'],
  'edit.lower-case': ['edit', 'Lower case'],
  'edit.title-case': ['edit', 'Title case'],
  'edit.duplicate-block': ['edit', 'Duplicate the block'],
  'edit.move-block-up': ['edit', 'Move the block up'],
  'edit.move-block-down': ['edit', 'Move the block down'],
  'edit.follow-link': ['edit', 'Follow the link'],

  'table.below': ['table', 'Into the table below'],
  'table.above': ['table', 'Into the table above'],
  'table.ahead': ['table', 'Forward into the table'],
  'table.behind': ['table', 'Back into the table'],
  'table.delete': ['table', 'Forward into the table instead of deleting'],
  'table.backspace': ['table', 'Back into the table instead of deleting'],

  'image.select-behind': ['picture', 'Select the picture behind'],
  'image.select-ahead': ['picture', 'Select the picture ahead'],
  'image.edit': ['picture', 'Edit the picture’s markdown'],
  'image.leave': ['picture', 'Leave the selected picture'],
  'image.step-up': ['picture', 'Step off the picture upwards'],
  'image.step-down': ['picture', 'Step off the picture downwards'],
}

const EDITOR_SPECS: BindingSpec[] = [
  ...ordenBindings,
  ...standardBindings,
  ...tableBindings,
  ...imageBindings,
]

function fromEditor(spec: BindingSpec): Shortcut {
  const named = EDITOR_ENTRIES[spec.id]

  return {
    id: spec.id,
    label: said(named ? named[1] : spec.id),
    category: named ? named[0] : 'edit',
    scope: 'editor',
    key: spec.key,
    ...(spec.mac === undefined ? {} : { mac: spec.mac }),
    ...(spec.win === undefined ? {} : { win: spec.win }),
    ...(spec.linux === undefined ? {} : { linux: spec.linux }),
    ...(spec.contextual === undefined ? {} : { contextual: spec.contextual }),
    ...(spec.alias === undefined ? {} : { alias: spec.alias }),
  }
}

async function runExport(id: ExportId) {
  await commandRowsLoaded()
  const command = commandRows('export').find((one) => one.id === `export-${id}`)
  if (command && command.disabled !== true) command.run()
}

const PANE_WAYS: readonly [Toward, string, string][] = [
  ['left', 'h', 'Pane to the left'],
  ['down', 'j', 'Pane below'],
  ['up', 'k', 'Pane above'],
  ['right', 'l', 'Pane to the right'],
]

const APP_ENTRIES: Shortcut[] = [
  app('file', 'app.new', 'New note', 'Mod-Alt-n', () => {
    if (hiddenKinds.offers('note')) workspace.openBlank()
  }),
  app('file', 'app.new-kind', 'New tab', 'Mod-t', () => workspace.newTab()),
  app(
    'file',
    'app.new-window',
    'New window',
    null,
    () => void invoke('new_window').catch(() => undefined),
    { desktop: true },
  ),
  app(
    'file',
    'app.new-private',
    'New private tab',
    'Mod-Shift-n',
    () => {
      if (hiddenKinds.offers('private')) void runCommand('app.new-private')
    },
    { desktop: true },
  ),
  app('file', 'app.random-note', 'Random note', null, () => void runCommand('app.random-note')),
  app('file', 'app.close', 'Close note', 'Mod-w', () => void runCommand('app.close')),
  app('file', 'app.close-window', 'Close window', 'Mod-Shift-w', () => void closeWindow(), {
    desktop: true,
  }),
  app('view', 'app.back', 'Back', 'Alt-ArrowLeft', () => workspace.goBack(), { mac: 'Ctrl-[' }),
  panel('view', 'web.address', 'Address', 'Mod-l'),
  panel('view', 'web.devtools', 'Developer tools', 'F12'),
  panel('view', 'web.devtools.alt', 'Developer tools', 'Mod-Shift-i', {
    mac: 'Mod-Alt-i',
    alias: true,
  }),
  panel('view', 'web.history', 'History', 'Mod-h', { mac: 'Mod-y' }),
  panel('view', 'web.clear-data', 'Delete browsing data', 'Mod-Shift-Delete', {
    mac: 'Mod-Shift-Backspace',
  }),
  panel('view', 'web.mute', 'Mute site', null),
  app('view', 'app.forward', 'Forward', 'Alt-ArrowRight', () => workspace.goForward(), {
    mac: 'Ctrl-]',
  }),
  app(
    'file',
    'app.reopen',
    'Reopen closed tab',
    'Mod-Shift-t',
    () => void workspace.reopenClosed(),
  ),
  app(
    'file',
    'app.close-right',
    () => closeAfterLabel(),
    null,
    () => closeAroundActive('right'),
  ),
  app('file', 'app.close-all', 'Close all tabs', null, () => closeAroundActive('all')),
  app(
    'file',
    'app.duplicate-tab',
    'Duplicate tab',
    null,
    () => void runCommand('app.duplicate-tab'),
  ),
  app('file', 'app.settings', 'Settings', 'Mod-,', () => settingsWindow().show()),
  app(
    'file',
    'app.keys',
    'Keyboard shortcuts',
    'Mod-Shift-/',
    () => settingsWindow().show('shortcuts'),
    { mac: null },
  ),
  app('file', 'app.print', 'Print', 'Mod-p', () => void runCommand('app.print')),
  ...EXPORT_KEYS.map((id) =>
    app(
      'file',
      `export.${id}`,
      () => labelOf(id),
      null,
      () => void runExport(id),
    ),
  ),
  app(
    'view',
    'app.next-note',
    'Next note',
    'Mod-Tab',
    (context) => cycleTab(1, true, context.held),
    { mac: 'Ctrl-Tab' },
  ),
  app(
    'view',
    'app.previous-note',
    'Previous note',
    'Mod-Shift-Tab',
    (context) => cycleTab(-1, true, context.held),
    { mac: 'Ctrl-Shift-Tab' },
  ),
  app('view', 'app.next-note.alt', 'Next note', 'Mod-PageDown', () => cycleTab(1), {
    mac: 'Mod-Shift-]',
    alias: true,
  }),
  app('view', 'app.previous-note.alt', 'Previous note', 'Mod-PageUp', () => cycleTab(-1), {
    mac: 'Mod-Shift-[',
    alias: true,
  }),
  app('view', 'app.move-tab-left', 'Move tab left', 'Mod-Shift-PageUp', () => moveTab(-1)),
  app('view', 'app.move-tab-right', 'Move tab right', 'Mod-Shift-PageDown', () => moveTab(1)),
  app('view', 'app.deselect-tab', 'Deselect tab', 'Mod-d', () => workspace.deselect()),
  app('view', 'app.deselect-all', 'Deselect all tabs', 'Mod-Shift-d', () =>
    workspace.deselectAll(),
  ),
  panel('view', 'tabs.rename', 'Rename', 'F2'),
  app('view', 'pane.split-right', 'Split right', 'Mod-Alt-ArrowRight', () =>
    workspace.split('row'),
  ),
  app('view', 'pane.split-down', 'Split down', 'Mod-Alt-ArrowDown', () =>
    workspace.split('column'),
  ),
  app(
    'view',
    'pane.move-tab',
    'Move to other pane',
    'Mod-Alt-Shift-ArrowRight',
    () => void runCommand('pane.move-tab'),
  ),
  app('view', 'pane.focus-next', 'Other pane', 'Mod-Alt-o', () => workspace.panes.focusNext()),
  ...PANE_WAYS.map(([toward, letter, label]) =>
    app(
      'view',
      `pane.focus-${toward}`,
      label,
      `Alt-${letter}`,
      () => void paneMoves().then((one) => one.movePane(toward)),
      { mac: null },
    ),
  ),
  app('view', 'app.tab-overview', 'Tabs', 'Alt Alt', () => toggleTabOverview()),
  app('view', 'app.palette', 'Command palette', 'Shift Shift', (context) =>
    context.palette(undefined, context.tapped),
  ),
  app(
    'view',
    'app.palette.alt',
    'Command palette',
    null,
    (context) => context.palette(undefined, context.tapped),
    { alias: true },
  ),
  app(
    'view',
    'app.palette.open',
    'Command palette',
    'Mod-o',
    (context) => context.palette(undefined, context.tapped),
    { alias: true },
  ),
  app('view', 'app.commands', 'Commands', 'Mod-Shift-p', (context) => context.palette('commands')),
  app('view', 'app.commands.alt', 'Commands', null, (context) => context.palette('commands'), {
    alias: true,
  }),
  app('file', 'app.quick-add', 'Add task', 'Ctrl-Alt-Space', () => showQuickAdd()),
  panel('file', 'tasks.quick-add', 'Add task', 'q', { alias: true }),
  app('view', 'app.sidebar', 'Left sidebar', 'Mod-Shift-l', () => workspace.toggleSidebar()),
  app('view', 'app.right-sidebar', 'Right sidebar', 'Mod-Alt-b', () =>
    workspace.toggleSidebar('right'),
  ),
  app('view', 'app.files', 'Files', 'Mod-Shift-e', () => revealPanel('tree')),
  app('panel', 'app.reveal', 'Show in the file list', null, () => workspace.revealNote()),
  app('panel', 'app.fold-list', 'Collapse the file list', null, () => workspace.foldList()),
  app('view', 'app.outline', 'Outline', 'Mod-Shift-o', () => revealPanel('outline')),
  app('view', 'app.search', 'Search this space', 'Mod-Shift-f', (context) =>
    searching()?.fromView(context.view),
  ),
  app(
    'view',
    'app.refresh',
    'Reload',
    null,
    () =>
      void refreshing()
        .then(({ refreshHere }) => refreshHere())
        .catch(() => undefined),
  ),
  app('view', 'app.links', 'Links', 'Mod-Shift-b', () => revealPanel('links')),
  ...(__EVEN_PLUGIN__
    ? []
    : [
        app(
          'paragraph',
          'app.handwriting',
          'Handwriting',
          null,
          () => void runCommand('app.handwriting'),
        ),
        app('view', 'app.tasks', 'Todos', 'Mod-Shift-y', () => void runCommand('views.todos')),
        app('view', 'app.chats', 'Chats', 'Mod-Shift-u', () => revealPanel('chats'), {
          shown: () => chatsOn(),
        }),
        app('view', 'app.time', 'Time tracker', null, () => revealPanel('time'), {
          shown: () => timeOn(),
        }),
        app('view', 'time.tab', 'Open time tracker', null, () => void runCommand('time.tab'), {
          shown: () => timeOn(),
        }),
        app('view', 'time.start', 'Start timer', null, () => void runCommand('time.start'), {
          shown: () => timeOn(),
        }),
        app('view', 'time.stop', 'Stop timer', null, () => void runCommand('time.stop'), {
          shown: () => timeOn(),
        }),
        panel('view', 'chat.jump-new', 'New messages', 'Mod-j'),
        panel('view', 'chat.record', 'Voice message', 'Mod-Shift-m'),
        panel('view', 'chat.search', 'Search this chat', 'Mod-f'),
        panel('view', 'chat.members', 'Members', 'Mod-u'),
      ]),
  app('view', 'app.ask', 'Ask', 'Mod-Shift-a', () => {
    if (!askAgain?.()) revealPanel('ask')
  }),
  app(
    'view',
    'app.ask-selection',
    'Selection to the AI panel',
    'Mod-Alt-k',
    () => void runCommand('app.ask-selection'),
    { shown: () => !__EVEN_PLUGIN__ },
  ),
  app(
    'view',
    'app.quick-question',
    'Quick question',
    'Mod Mod',
    () => void runCommand('app.quick-question'),
  ),
  app('view', 'app.reload', 'Reload Orden', 'Mod-r', () => location.reload()),
  app('view', 'app.scratchpad', 'Scratchpad', 'Mod-n', () => void runCommand('app.scratchpad')),
  app(
    'view',
    'app.scratchpad.alt',
    'Scratchpad',
    'Mod-Shift-x',
    () => void runCommand('app.scratchpad'),
    { alias: true },
  ),
  app(
    'view',
    'agents.stop',
    'Stop agents',
    'Mod-Alt-Shift-k',
    () => void runCommand('agents.stop'),
    { mac: 'Mod-Ctrl-Alt-k', desktop: true, shown: () => !__EVEN_PLUGIN__ },
  ),
  app('view', 'app.region-next', 'Next section', 'F6', () => void stepRegionFocus(1)),
  app(
    'view',
    'app.region-previous',
    'Previous section',
    'Shift-F6',
    () => void stepRegionFocus(-1),
  ),
  app('view', 'space.previous', 'Previous space', 'Mod-Shift-,', () => stepSpace(-1)),
  app('view', 'space.next', 'Next space', 'Mod-Shift-.', () => stepSpace(1)),
  app('view', 'space.switcher', 'Spaces', 'Mod-Space', toggleSpacePicker, {
    mac: 'Mod-Shift-Space',
  }),
  app('view', 'space.switcher.alt', 'Spaces', 'Mod-Shift-Space', toggleSpacePicker, {
    mac: null,
    alias: true,
  }),
  app(
    'view',
    'app.explorer',
    'File explorer',
    'Mod-Alt-e',
    () => {
      if (hiddenKinds.offers('explorer')) void runCommand('app.explorer')
    },
    { desktop: true },
  ),
  ...(__EVEN_PLUGIN__
    ? []
    : [
        app('view', 'app.pass', 'Pass', 'Mod-Alt-v', () => void runCommand('pass.open'), {
          shown: () => passOn(),
        }),
      ]),
  app('view', 'app.graph', 'Graph', null, () => workspace.openGraph()),
  app('view', 'app.source', 'Source mode', 'Mod-/', (context) => modes.toggleSource(context.view)),
  app('view', 'app.focus', 'Focus mode', 'F8', (context) => modes.toggleFocus(context.view), {
    mac: 'Mod-Ctrl-o',
  }),
  app(
    'view',
    'app.typewriter',
    'Typewriter mode',
    'F9',
    (context) => modes.toggleTypewriter(context.view),
    { mac: 'Mod-Ctrl-t' },
  ),
  app('view', 'app.reading', 'Reading', 'Mod-e', () => workspace.toggleReading()),
  app(
    'view',
    'app.read-only',
    'Read-only',
    'F10',
    (context) => modes.toggleReadOnly(context.view),
    { mac: 'Mod-Ctrl-r' },
  ),
  app('view', 'app.fullscreen', 'Fullscreen', 'F11', (context) => context.fullscreen(), {
    mac: 'Mod-Ctrl-f',
  }),
  app(
    'view',
    'app.fill-tab',
    'Full window',
    'Shift-F11',
    () => void import('../../tab-fill/src/api').then((one) => one.toggleFill()),
    { mac: 'Mod-Ctrl-Shift-f' },
  ),
  app(
    'view',
    'app.zoom-in',
    'Zoom in',
    'Mod-=',
    () => workspace.zoomPage('in') || modes.stepZoom(1),
  ),
  app(
    'view',
    'app.zoom-out',
    'Zoom out',
    'Mod--',
    () => workspace.zoomPage('out') || modes.stepZoom(-1),
  ),
  app(
    'view',
    'app.zoom-reset',
    'Actual size',
    'Mod-0',
    () => workspace.zoomPage('reset') || modes.resetZoom(),
  ),
]

const LAST = 8

const noteAt = (index: number) => `Note ${index + 1}`

const NUMBERED: Shortcut[] = Array.from({ length: 9 }, (_unused, index) =>
  app(
    'view',
    `app.note-${index + 1}`,
    index === LAST ? 'Last note' : noteAt(index),
    `Mod-Alt-${index + 1}`,
    () => showTab(index === LAST ? 'last' : index),
    { mac: `Mod-${index + 1}` },
  ),
)

const ALT_NUMBERED: Shortcut[] = Array.from({ length: 10 }, (_unused, index): Shortcut => {
  const digit = (index + 1) % 10
  const at = digit === 0 ? 'last' : index
  const ninth = at === LAST

  return app(
    'view',
    ninth ? 'app.note-ninth' : `app.note-${at === 'last' ? LAST + 1 : digit}.alt`,
    at === 'last' ? 'Last note' : noteAt(at),
    `Alt-${digit}`,
    () => showTab(at),
    { mac: null, ...(ninth ? {} : { alias: true }) },
  )
})

export function showTab(at: number | 'last') {
  const tabs = workspace.tabsIn(workspace.panes.focusedId)
  const tab = at === 'last' ? tabs.at(-1) : tabs[at]
  if (tab) workspace.activate(tab.id)
}

const PANEL_ENTRIES: Shortcut[] = [
  panel('panel', 'tree.select-all', 'Select every file', 'Mod-a'),
  panel('panel', 'tree.deselect', 'Clear the selection', 'Escape'),
  panel('panel', 'tree.delete', 'Delete the selected files', 'Delete', { mac: 'Mod-Backspace' }),
  panel('panel', 'tree.delete.alt', 'Delete the selected files', 'Backspace', {
    mac: 'Mod-Delete',
    alias: true,
  }),
  panel('panel', 'tree.down', 'Next file', 'ArrowDown'),
  panel('panel', 'tree.up', 'Previous file', 'ArrowUp'),
  panel('panel', 'tree.into', 'Show what it holds', 'ArrowRight'),
  panel('panel', 'tree.out', 'Hide what it holds', 'ArrowLeft'),
  panel('panel', 'tree.open', 'Open', 'Enter'),
  panel('panel', 'tree.rename', 'Rename', 'F2', { mac: 'Mod-Enter' }),
  panel('panel', 'tree.extend-down', 'Select down', 'Shift-ArrowDown'),
  panel('panel', 'tree.extend-up', 'Select up', 'Shift-ArrowUp'),
  panel('panel', 'tree.toggle', 'Select or deselect', 'Mod-Shift-Enter'),
  panel('panel', 'tree.duplicate', 'Duplicate', null),
  panel('panel', 'tree.move-up', 'Move up', 'Alt-ArrowUp'),
  panel('panel', 'tree.move-down', 'Move down', 'Alt-ArrowDown'),
  panel('panel', 'list.menu', 'Menu for this row', 'Shift-F10'),
  panel('panel', 'list.menu.alt', 'Menu for this row', 'ContextMenu', { alias: true }),
]

const CANVAS_ENTRIES: Shortcut[] = (
  [
    ['canvas.tool.select', 'Select', 'v'],
    ['canvas.tool.hand', 'Pan', 'h'],
    ['canvas.tool.draw', 'Draw', 'd'],
    ['canvas.tool.erase', 'Erase', 'e'],
    ['canvas.tool.lasso', 'Lasso', 'q'],
    ['canvas.tool.text', 'Card', 'c'],
    ['canvas.tool.words', 'Text', 'w'],
    ['canvas.tool.file', 'Note', 'n'],
    ['canvas.tool.picture', 'Picture', 'i'],
    ['canvas.tool.link', 'Link', 'k'],
    ['canvas.tool.group', 'Frame', 'f'],
    ['canvas.tool.rect', 'Rectangle', 'r'],
    ['canvas.tool.ellipse', 'Oval', 'o'],
    ['canvas.tool.rhombus', 'Diamond', 'm'],
    ['canvas.tool.triangle', 'Triangle', 't'],
    ['canvas.tool.line', 'Line', 'l'],
    ['canvas.tool.arrow', 'Arrow', 'a'],
    ['canvas.tool.elbow', 'Elbow', 'b'],
    ['canvas.write', 'Write in what is picked', 'Enter'],
    ['canvas.group', 'Group', 'g'],
    ['canvas.ungroup', 'Ungroup', 'u'],
    ['canvas.delete', 'Delete what is picked', 'Delete'],
    ['canvas.duplicate', 'Duplicate', 'Mod-d'],
    ['canvas.fit', 'Fit the canvas', 'Mod-Alt-0'],
    ['canvas.zoom.in', 'Zoom in', 'Mod-Alt-='],
    ['canvas.zoom.out', 'Zoom out', 'Mod-Alt--'],
    ['canvas.zoom.actual', 'Actual size', null],
    ['canvas.upright', 'Turn upright', 'Mod-Alt-r'],
    ['canvas.frame', 'Zoom to what is picked', 'Mod-1'],
    ['canvas.find', 'Find on the canvas', 'Mod-f'],
    ['canvas.front', 'Bring to front', 'Mod-Shift-]'],
    ['canvas.forward', 'Bring forward', 'Mod-]'],
    ['canvas.back', 'Send to back', 'Mod-Shift-['],
    ['canvas.backward', 'Send backward', 'Mod-['],
    ['canvas.nudge.left', 'Nudge left', 'ArrowLeft'],
    ['canvas.nudge.right', 'Nudge right', 'ArrowRight'],
    ['canvas.nudge.up', 'Nudge up', 'ArrowUp'],
    ['canvas.nudge.down', 'Nudge down', 'ArrowDown'],
  ] as const
).map(([id, label, key]) => panel('canvas', id, label, key))

const PAGES_ENTRIES: Shortcut[] = (
  [
    ['pages.zoom.in', 'Zoom in', 'Mod-Alt-='],
    ['pages.zoom.out', 'Zoom out', 'Mod-Alt--'],
    ['pages.fit', 'Fit width', 'Mod-Alt-0'],
    ['pages.fit.page', 'Fit page', null],
    ['pages.add', 'Add a page', null],
  ] as const
).map(([id, label, key]) => panel('pages', id, label, key))

const MAC_CANVAS: Record<string, string> = {
  'canvas.frame': 'Mod-Alt-1',
  'canvas.front': 'Mod-Alt-]',
  'canvas.back': 'Mod-Alt-[',
}
for (const entry of CANVAS_ENTRIES) {
  const mac = MAC_CANVAS[entry.id]
  if (mac) entry.mac = mac
}

const WEB_ENTRIES: Shortcut[] = (
  [
    ['web.address.alt', 'Address', 'Alt-d', null],
    ['web.reload', 'Reload', 'F5', 'Mod-r'],
    ['web.reload.alt', 'Reload', 'Mod-r', null],
    ['web.fresh', 'Hard reload', 'Mod-Shift-r', undefined],
    ['web.fresh.alt', 'Hard reload', 'Mod-F5', null],
    ['web.stop', 'Stop', 'Escape', undefined],
    ['web.back', 'Back', null, 'Mod-['],
    ['web.forward', 'Forward', null, 'Mod-]'],
  ] as const
).map(([id, label, key, mac]) =>
  panel('view', id, label, key, {
    ...(mac === undefined ? {} : { mac }),
    ...(id.endsWith('.alt') ? { alias: true } : {}),
  }),
)

const AI_ENTRIES: Shortcut[] = (
  [
    ['ai.mode', 'Next mode', 'Shift-Tab'],
    ['ai.model', 'Model and effort', 'Alt-p'],
    ['ai.effort', 'Next effort', 'Alt-t'],
    ['ai.steer', 'Send into the running answer', 'Mod-Enter'],
    ['ai.stop', 'Stop the answer', 'Escape'],
    ['ai.unfold', 'Open every step', 'Mod-o'],
    ['ai.new', 'New chat', 'Mod-n'],
  ] as const
).map(([id, label, key]) => panel('view', id, label, key))

const FIELD_ENTRIES: Shortcut[] = [panel('edit', 'field.dictate', 'Dictate', 'Alt-v')]

CANVAS_ENTRIES.push(
  panel('canvas', 'canvas.delete.alt', 'Delete what is picked', 'Backspace', { alias: true }),
)

let cycling: typeof import('../../tab-cycle/src/api') | null = null

function cycleTab(direction: number, mayUseOrder = false, held = false) {
  if (cycling) {
    cycling.cycleTab(direction, mayUseOrder, held)
    return
  }

  void import('../../tab-cycle/src/api').then((one) => {
    cycling = one
    one.cycleTab(direction, mayUseOrder, held)
  })
}

function closeAroundActive(which: Around) {
  const id = workspace.activeTabId
  if (which === 'all') void workspace.closeAllIn(workspace.panes.focusedId)
  else if (id) void workspace.closeAround(id, which)
}

function moveTab(direction: number) {
  const paneId = workspace.panes.focusedId
  const tabs = workspace.tabsIn(paneId)
  const at = tabs.findIndex((tab) => tab.id === workspace.activeTabId)
  const tab = tabs[at]
  const slot = at + direction
  if (!tab || slot < 0 || slot >= tabs.length) return

  workspace.moveTab(tab.id, paneId, slot)
}

export const FIXED_ENTRIES: Shortcut[] = [
  fixed('fixed.cut', 'Cut', 'Mod-x', 'The clipboard belongs to the system.'),
  fixed('fixed.copy', 'Copy', 'Mod-c', 'The clipboard belongs to the system.'),
  fixed('fixed.paste', 'Paste', 'Mod-v', 'The clipboard belongs to the system.'),
  fixed(
    'fixed.caret',
    'Moving the caret',
    null,
    'The arrow keys, Home, End, Page up and Page down belong to the text.',
  ),
  fixed('fixed.delete', 'Deleting a character', null, 'Backspace and Delete belong to the text.'),
  fixed('fixed.newline', 'New line', 'Enter', 'Enter closes a code block and carries a list on.'),
  fixed(
    'fixed.tab',
    'Indent with Tab',
    'Tab',
    'Tab moves on through the app as well as indenting.',
  ),
  fixed('fixed.escape', 'Escape', 'Escape', 'Escape closes whatever is open.'),
  fixed(
    'fixed.lists',
    'Moving through a list',
    null,
    'The arrow keys, Enter and Esc work whatever is open; they are not shortcuts.',
  ),
  fixed('fixed.quit', 'Quit', 'Alt-F4', 'Your system takes this key before the app sees it.', {
    mac: 'Mod-q',
  }),
]

const EXPLORER_ENTRIES: Shortcut[] = (
  [
    ['explorer.parent', 'Folder above', 'Backspace', 'Mod-ArrowUp'],
    ['explorer.parent.alt', 'Folder above', 'Alt-ArrowUp', 'Alt-ArrowUp'],
    ['explorer.location', 'Type a location', 'Mod-l', 'Mod-Shift-g'],
    ['explorer.hidden', 'Hidden files', 'Mod-h', 'Mod-Shift-h'],
    ['explorer.new-folder', 'New folder', 'Mod-Shift-n', 'Mod-Shift-n'],
    ['explorer.delete', 'Delete for good', 'Shift-Delete', 'Mod-Alt-Backspace'],
    ['explorer.filter', 'Filter', 'Mod-f', 'Mod-f'],
    ['explorer.search', 'Search below this folder', 'Mod-Shift-f', 'Mod-Shift-f'],
    ['explorer.look', 'Quick look', 'Space', 'Space'],
    ['explorer.preview', 'Preview', 'Alt-p', 'Mod-Alt-p'],
    ['explorer.list', 'List', 'Mod-1', 'Mod-1'],
    ['explorer.grid', 'Grid', 'Mod-2', 'Mod-2'],
    ['explorer.columns', 'Columns', 'Mod-3', 'Mod-3'],
  ] as const
).map(([id, label, key, mac]) =>
  panel('explorer', id, label, key, { mac, ...(id.endsWith('.alt') ? { alias: true } : {}) }),
)

const PASS_KEYS: readonly (readonly [string, string, string])[] = __EVEN_PLUGIN__
  ? []
  : [
      ['pass.search', 'Search Pass', 'Mod-f'],
      ['pass.new-login', 'New login', 'Mod-n'],
    ]

const PASS_ENTRIES: Shortcut[] = PASS_KEYS.map(([id, label, key]) =>
  panel('pass', id, label, key, { shown: () => passOn() }),
)

export const SHORTCUTS: Shortcut[] = [
  ...APP_ENTRIES,
  ...NUMBERED,
  ...ALT_NUMBERED,
  ...EDITOR_SPECS.map(fromEditor),
  ...PANEL_ENTRIES,
  ...EXPLORER_ENTRIES,
  ...PASS_ENTRIES,
  ...CANVAS_ENTRIES,
  ...PAGES_ENTRIES,
  ...WEB_ENTRIES,
  ...AI_ENTRIES,
  ...FIELD_ENTRIES,
  ...FIXED_ENTRIES,
]

export const BY_ID = new Map(SHORTCUTS.map((one) => [one.id, one]))

const EDITOR_BY_ID = new Map(EDITOR_SPECS.map((one) => [one.id, one]))

export function runEntry(id: string, context: AppContext, via?: UsageVia): boolean {
  const spec = EDITOR_BY_ID.get(id)
  if (spec) {
    const view = context.view
    if (!view) return false

    if (via) ran(id, via)
    spec.run(view)
    view.focus()
    return true
  }

  const entry = BY_ID.get(id)
  if (entry?.scope !== 'app' || !entry.run || entry.shown?.() === false) return false

  if (via) ran(id, via)
  entry.run(context)
  return true
}

export function known(id: string): boolean {
  if (EDITOR_BY_ID.has(id)) return true

  const entry = BY_ID.get(id)
  return !!entry && entry.scope === 'app' && !!entry.run
}

export function offeredHere(entry: Shortcut): boolean {
  return (isDesktop || !entry.desktop) && entry.shown?.() !== false
}

export function runnable(id: string): boolean {
  if (EDITOR_BY_ID.has(id)) return true

  const entry = BY_ID.get(id)
  return !!entry && known(id) && offeredHere(entry)
}

export const SYSTEM_KEYS: Record<Platform, string[]> = {
  mac: [
    'Mod-q',
    'Mod-h',
    'Mod-Alt-h',
    'Mod-m',
    'Mod-Shift-q',
    'Mod-Alt-Escape',
    'Mod-Ctrl-q',
    'Mod-Tab',
    'Mod-Shift-Tab',
    'Mod-`',
    'Mod-Shift-`',
    'Mod-Space',
    'Mod-Alt-Space',
    'Ctrl-Space',
    'Mod-Ctrl-Space',
    'Mod-Shift-3',
    'Mod-Shift-4',
    'Mod-Shift-5',
    'Ctrl-ArrowUp',
    'Ctrl-ArrowDown',
    'Ctrl-ArrowLeft',
    'Ctrl-ArrowRight',
    'F11',
    'Mod-Alt-d',
    'Mod-Ctrl-d',
  ],
  win: ['Alt-F4', 'Alt-Tab', 'Meta-l', 'Ctrl-Shift-Escape'],
  linux: ['Alt-F4', 'Alt-Tab'],
}

export const DICTATION_TAPS: Record<Platform, string[]> = {
  mac: ['Ctrl Ctrl'],
  win: [],
  linux: [],
}

export const BROWSER_KEYS = [
  'F12',
  'F5',
  'F11',
  'Mod-Shift-i',
  'Mod-Shift-j',
  'Mod-Shift-c',
  'Mod-r',
  'Mod-Shift-r',
  'Mod-w',
  'Mod-t',
  'Mod-n',
  'Mod-Shift-n',
  'Mod-Shift-t',
]
