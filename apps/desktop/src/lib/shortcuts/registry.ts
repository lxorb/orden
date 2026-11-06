import {
  type BindingSpec,
  type EditorView,
  imageBindings,
  nibBindings,
  standardBindings,
  tableBindings,
} from '@orden/editor'
import { type ExportId, EXPORT_KEYS, labelOf } from '../export/offer'
import { revealPanel, stepRegionFocus } from '../focus'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { searchFrom } from '../search.svelte'
import { askQuickly } from '../ai/quick-door'
import { showQuickAdd, toggleTabOverview } from '../surfaces.svelte'
import { toggleScratchpad } from '../scratchpad/is.svelte'
import { hiddenKinds, settings } from '../settings.svelte'
import { stepSpace } from '../space-actions'
import { present } from '../slides/present.svelte'
import { picks } from '../tab-strip/drag.svelte'
import { closeWindow, invoke, isDesktop, platform } from '../tauri'
import type { Platform } from '../keys'
import { workspace } from '../workspace.svelte'
import type { Toward } from '../workspace/pane-tree'
import { type Around, closeAfterLabel } from '../workspace/closing-around'

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
  | 'fixed'

export const CATEGORIES: { id: Category; label: () => string }[] = [
  { id: 'file', label: () => t('File') },
  { id: 'edit', label: () => t('Edit') },
  { id: 'format', label: () => t('Format') },
  { id: 'paragraph', label: () => t('Paragraph') },
  { id: 'view', label: () => t('View') },
  { id: 'panel', label: () => t('File list') },
  { id: 'canvas', label: () => t('Canvas') },
  { id: 'pages', label: () => t('Pages') },
  { id: 'table', label: () => t('Tables') },
  { id: 'picture', label: () => t('Pictures') },
  { id: 'explorer', label: () => t('File explorer') },
  { id: 'fixed', label: () => t('Fixed keys') },
]

export interface AppContext {
  view?: EditorView | undefined
  palette(mode?: 'commands', again?: boolean): void
  fullscreen(): void
  tapped?: boolean
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
}

const EDITOR_ENTRIES: Record<string, [Category, () => string]> = {
  'format.bold': ['format', () => t('Bold')],
  'format.italic': ['format', () => t('Italic')],
  'format.underline': ['format', () => t('Underline')],
  'format.code': ['format', () => t('Code')],
  'format.strikethrough': ['format', () => t('Strikethrough')],
  'format.highlight': ['format', () => t('Highlight')],
  'format.link': ['format', () => t('Link')],
  'format.image': ['format', () => t('Image')],
  'format.clear': ['format', () => t('Clear formatting')],
  'format.comment': ['format', () => t('Comment')],

  'paragraph.body': ['paragraph', () => t('Paragraph')],
  'paragraph.heading-1': ['paragraph', () => t('Heading {level}', { level: 1 })],
  'paragraph.heading-2': ['paragraph', () => t('Heading {level}', { level: 2 })],
  'paragraph.heading-3': ['paragraph', () => t('Heading {level}', { level: 3 })],
  'paragraph.heading-4': ['paragraph', () => t('Heading {level}', { level: 4 })],
  'paragraph.heading-5': ['paragraph', () => t('Heading {level}', { level: 5 })],
  'paragraph.heading-6': ['paragraph', () => t('Heading {level}', { level: 6 })],
  'paragraph.heading-up': ['paragraph', () => t('One heading level up')],
  'paragraph.heading-down': ['paragraph', () => t('One heading level down')],
  'paragraph.table': ['paragraph', () => t('Table')],
  'paragraph.code-block': ['paragraph', () => t('Code block')],
  'paragraph.math-block': ['paragraph', () => t('Math block')],
  'paragraph.chart': ['paragraph', () => t('Chart')],
  'paragraph.quote': ['paragraph', () => t('Quote')],
  'paragraph.ordered-list': ['paragraph', () => t('Numbered list')],
  'paragraph.bullet-list': ['paragraph', () => t('Bulleted list')],
  'paragraph.rule': ['paragraph', () => t('Horizontal rule')],
  'paragraph.task-list': ['paragraph', () => t('Task list')],
  'paragraph.task': ['paragraph', () => t('Tick the task')],
  'paragraph.callout': ['paragraph', () => t('Callout')],
  'paragraph.footnote': ['paragraph', () => t('Footnote')],
  'paragraph.toc': ['paragraph', () => t('Table of contents')],

  'view.fold': ['view', () => t('Fold')],
  'view.fold-all': ['view', () => t('Fold everything')],
  'view.fold-more': ['view', () => t('Fold more')],
  'view.fold-less': ['view', () => t('Fold less')],
  'view.unfold-all': ['view', () => t('Unfold everything')],

  'edit.indent': ['edit', () => t('Indent')],
  'edit.outdent': ['edit', () => t('Outdent')],
  'edit.run-fence': ['edit', () => t('Run this code block')],
  'edit.select-word': ['edit', () => t('Select the word, then the next')],
  'edit.select-line': ['edit', () => t('Select the line')],
  'edit.select-all-occurrences': ['edit', () => t('Select every one like it')],
  'edit.expand-selection': ['edit', () => t('Expand the selection')],
  'edit.shrink-selection': ['edit', () => t('Shrink the selection')],
  'edit.cursor-above': ['edit', () => t('Add a cursor above')],
  'edit.cursor-below': ['edit', () => t('Add a cursor below')],
  'edit.copy-markdown': ['edit', () => t('Copy as markdown')],
  'edit.paste-plain': ['edit', () => t('Paste as plain text')],
  'edit.undo': ['edit', () => t('Undo')],
  'edit.redo': ['edit', () => t('Redo')],
  'edit.redo.alt': ['edit', () => t('Redo')],
  'edit.select-all': ['edit', () => t('Select all')],
  'edit.find': ['edit', () => t('Find')],
  'edit.replace': ['edit', () => t('Replace')],
  'edit.find-next': ['edit', () => t('Find next')],
  'edit.find-next.alt': ['edit', () => t('Find next')],
  'edit.find-previous': ['edit', () => t('Find previous')],
  'edit.find-previous.alt': ['edit', () => t('Find previous')],
  'edit.goto-line': ['edit', () => t('Go to line')],
  'edit.move-line-up': ['edit', () => t('Move the line up')],
  'edit.move-line-down': ['edit', () => t('Move the line down')],
  'edit.copy-line-up': ['edit', () => t('Copy the line up')],
  'edit.copy-line-down': ['edit', () => t('Copy the line down')],
  'edit.insert-line-above': ['edit', () => t('Insert a line above')],
  'edit.delete-line': ['edit', () => t('Delete the line')],
  'edit.join-lines': ['edit', () => t('Join the lines')],
  'edit.sort-lines': ['edit', () => t('Sort the lines')],
  'edit.reverse-lines': ['edit', () => t('Reverse the lines')],
  'edit.upper-case': ['edit', () => t('Upper case')],
  'edit.lower-case': ['edit', () => t('Lower case')],
  'edit.title-case': ['edit', () => t('Title case')],
  'edit.duplicate-block': ['edit', () => t('Duplicate the block')],
  'edit.move-block-up': ['edit', () => t('Move the block up')],
  'edit.move-block-down': ['edit', () => t('Move the block down')],
  'edit.follow-link': ['edit', () => t('Follow the link')],

  'table.below': ['table', () => t('Into the table below')],
  'table.above': ['table', () => t('Into the table above')],
  'table.ahead': ['table', () => t('Forward into the table')],
  'table.behind': ['table', () => t('Back into the table')],
  'table.delete': ['table', () => t('Forward into the table instead of deleting')],
  'table.backspace': ['table', () => t('Back into the table instead of deleting')],

  'image.select-behind': ['picture', () => t('Select the picture behind')],
  'image.select-ahead': ['picture', () => t('Select the picture ahead')],
  'image.edit': ['picture', () => t('Edit the picture’s markdown')],
  'image.leave': ['picture', () => t('Leave the selected picture')],
  'image.step-up': ['picture', () => t('Step off the picture upwards')],
  'image.step-down': ['picture', () => t('Step off the picture downwards')],
}

const EDITOR_SPECS: BindingSpec[] = [
  ...nibBindings,
  ...standardBindings,
  ...tableBindings,
  ...imageBindings,
]

function fromEditor(spec: BindingSpec): Shortcut {
  const named = EDITOR_ENTRIES[spec.id]

  return {
    id: spec.id,
    label: named ? named[1] : () => spec.id,
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

function runExport(id: ExportId) {
  void import('../commands').then(({ exportCommands }) => {
    const command = exportCommands().find((one) => one.id === `export-${id}`)
    if (command && !command.disabled) command.run()
  })
}

function runPrint() {
  void import('../commands').then(({ appCommands }) => {
    const command = appCommands().find((one) => one.id === 'print')
    if (command && !command.disabled) command.run()
  })
}

const onMac = () => isDesktop && platform() === 'macos'

const PANE_WAYS: readonly [Toward, string, () => string][] = [
  ['left', 'h', () => t('Pane to the left')],
  ['down', 'j', () => t('Pane below')],
  ['up', 'k', () => t('Pane above')],
  ['right', 'l', () => t('Pane to the right')],
]

const APP_ENTRIES: Shortcut[] = [
  {
    id: 'app.new',
    label: () => t('New note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Alt-n',
    run: () => {
      if (hiddenKinds.offers('note')) workspace.openBlank()
    },
  },
  {
    id: 'app.new-kind',
    label: () => t('New tab'),
    category: 'file',
    scope: 'app',
    key: 'Mod-t',
    run: () => workspace.newTab(),
  },
  {
    id: 'app.new-window',
    label: () => t('New window'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void invoke('new_window').catch(() => undefined),
    desktop: true,
  },
  {
    id: 'app.new-private',
    label: () => t('New private tab'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-n',
    run: () => {
      if (hiddenKinds.offers('private'))
        void import('../web-tab/private').then((one) => one.openPrivate())
    },
    desktop: true,
  },
  {
    id: 'app.random-note',
    label: () => t('Random note'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void import('../random-note').then(({ openRandomNote }) => openRandomNote()),
  },
  {
    id: 'app.close',
    label: () => t('Close note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-w',
    run: () => {
      const pick = picks.loaded
      const many = pick?.chosen.of(workspace.panes.focusedId) ?? []
      if (pick && many.length) void pick.closeChosen(many)
      else if (workspace.activeTabId || workspace.tabs.length || !onMac())
        void workspace.closeActive()
      else void closeWindow()
    },
  },
  {
    id: 'app.close-window',
    label: () => t('Close window'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-w',
    run: () => void closeWindow(),
    desktop: true,
  },
  {
    id: 'app.back',
    label: () => t('Back'),
    category: 'view',
    scope: 'app',
    key: 'Alt-ArrowLeft',
    mac: 'Ctrl-[',
    run: () => workspace.goBack(),
  },
  {
    id: 'web.address',
    label: () => t('Address'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-l',
    contextual: true,
  },
  {
    id: 'web.devtools',
    label: () => t('Developer tools'),
    category: 'view',
    scope: 'panel',
    key: 'F12',
    contextual: true,
  },
  {
    id: 'web.devtools.alt',
    label: () => t('Developer tools'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-Shift-i',
    mac: 'Mod-Alt-i',
    contextual: true,
    alias: true,
  },
  {
    id: 'web.history',
    label: () => t('History'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-h',
    mac: 'Mod-y',
    contextual: true,
  },
  {
    id: 'web.clear-data',
    label: () => t('Delete browsing data'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-Shift-Delete',
    mac: 'Mod-Shift-Backspace',
    contextual: true,
  },
  {
    id: 'web.mute',
    label: () => t('Mute site'),
    category: 'view',
    scope: 'panel',
    key: null,
    contextual: true,
  },
  {
    id: 'app.forward',
    label: () => t('Forward'),
    category: 'view',
    scope: 'app',
    key: 'Alt-ArrowRight',
    mac: 'Ctrl-]',
    run: () => workspace.goForward(),
  },
  {
    id: 'app.reopen',
    label: () => t('Reopen closed tab'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-t',
    run: () => void workspace.reopenClosed(),
  },
  {
    id: 'app.close-right',
    label: () => closeAfterLabel(),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => closeAroundActive('right'),
  },
  {
    id: 'app.close-all',
    label: () => t('Close all tabs'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => closeAroundActive('all'),
  },
  {
    id: 'app.duplicate-tab',
    label: () => t('Duplicate tab'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void tabOps().then((ops) => ops.duplicateTab(workspace.activeTabId ?? '')),
  },
  {
    id: 'app.settings',
    label: () => t('Settings'),
    category: 'file',
    scope: 'app',
    key: 'Mod-,',
    run: () => settings.show(),
  },
  {
    id: 'app.keys',
    label: () => t('Keyboard shortcuts'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-/',
    mac: null,
    run: () => settings.show('shortcuts'),
  },
  {
    id: 'app.print',
    label: () => t('Print'),
    category: 'file',
    scope: 'app',
    key: 'Mod-p',
    run: () => runPrint(),
  },
  ...EXPORT_KEYS.map((id): Shortcut => ({
    id: `export.${id}`,
    label: () => labelOf(id),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => runExport(id),
  })),
  {
    id: 'app.next-note',
    label: () => t('Next note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Tab',
    mac: 'Ctrl-Tab',
    run: () => cycleTab(1, true),
  },
  {
    id: 'app.previous-note',
    label: () => t('Previous note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Tab',
    mac: 'Ctrl-Shift-Tab',
    run: () => cycleTab(-1, true),
  },
  {
    id: 'app.next-note.alt',
    label: () => t('Next note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-PageDown',
    mac: 'Mod-Shift-]',
    alias: true,
    run: () => cycleTab(1),
  },
  {
    id: 'app.previous-note.alt',
    label: () => t('Previous note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-PageUp',
    mac: 'Mod-Shift-[',
    alias: true,
    run: () => cycleTab(-1),
  },
  {
    id: 'app.move-tab-left',
    label: () => t('Move tab left'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-PageUp',
    run: () => moveTab(-1),
  },
  {
    id: 'app.move-tab-right',
    label: () => t('Move tab right'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-PageDown',
    run: () => moveTab(1),
  },
  {
    id: 'app.deselect-tab',
    label: () => t('Deselect tab'),
    category: 'view',
    scope: 'app',
    key: 'Mod-d',
    run: () => workspace.deselect(),
  },
  {
    id: 'app.deselect-all',
    label: () => t('Deselect all tabs'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-d',
    run: () => workspace.deselectAll(),
  },
  {
    id: 'tabs.rename',
    label: () => t('Rename'),
    category: 'view',
    scope: 'panel',
    key: 'F2',
    contextual: true,
  },
  {
    id: 'pane.split-right',
    label: () => t('Split right'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-ArrowRight',
    run: () => workspace.split('row'),
  },
  {
    id: 'pane.split-down',
    label: () => t('Split down'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-ArrowDown',
    run: () => workspace.split('column'),
  },
  {
    id: 'pane.move-tab',
    label: () => t('Move to other pane'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-Shift-ArrowRight',
    run: () => void tabOps().then((ops) => ops.moveToOtherPane(workspace.activeTabId ?? '')),
  },
  {
    id: 'pane.focus-next',
    label: () => t('Other pane'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-o',
    run: () => workspace.panes.focusNext(),
  },
  ...PANE_WAYS.map(([toward, letter, label]): Shortcut => ({
    id: `pane.focus-${toward}`,
    label,
    category: 'view',
    scope: 'app',
    key: `Alt-${letter}`,
    mac: null,
    run: () => void import('../pane-moves').then((one) => one.movePane(toward)),
  })),
  {
    id: 'app.tab-overview',
    label: () => t('Tabs'),
    category: 'view',
    scope: 'app',
    key: 'Alt Alt',
    run: () => toggleTabOverview(),
  },
  {
    id: 'app.palette',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: 'Shift Shift',
    run: (context) => context.palette(undefined, context.tapped),
  },
  {
    id: 'app.palette.alt',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: null,
    alias: true,
    run: (context) => context.palette(undefined, context.tapped),
  },
  {
    id: 'app.palette.open',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: 'Mod-o',
    alias: true,
    run: (context) => context.palette(undefined, context.tapped),
  },
  {
    id: 'app.commands',
    label: () => t('Commands'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-p',
    run: (context) => context.palette('commands'),
  },
  {
    id: 'app.commands.alt',
    label: () => t('Commands'),
    category: 'view',
    scope: 'app',
    key: null,
    alias: true,
    run: (context) => context.palette('commands'),
  },
  {
    id: 'app.quick-add',
    label: () => t('Add task'),
    category: 'file',
    scope: 'app',
    key: 'Ctrl-Alt-Space',
    run: () => showQuickAdd(),
  },
  {
    id: 'tasks.quick-add',
    label: () => t('Add task'),
    category: 'file',
    scope: 'panel',
    key: 'q',
    contextual: true,
    alias: true,
  },
  {
    id: 'app.sidebar',
    label: () => t('Left sidebar'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-l',
    run: () => workspace.toggleSidebar(),
  },
  {
    id: 'app.right-sidebar',
    label: () => t('Right sidebar'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-b',
    run: () => workspace.toggleSidebar('right'),
  },
  {
    id: 'app.files',
    label: () => t('Files'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-e',
    run: () => revealPanel('tree'),
  },
  {
    id: 'app.reveal',
    label: () => t('Show in the file list'),
    category: 'panel',
    scope: 'app',
    key: null,
    run: () => workspace.revealNote(),
  },
  {
    id: 'app.fold-list',
    label: () => t('Collapse the file list'),
    category: 'panel',
    scope: 'app',
    key: null,
    run: () => workspace.foldList(),
  },
  {
    id: 'app.outline',
    label: () => t('Outline'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-o',
    run: () => revealPanel('outline'),
  },
  {
    id: 'app.search',
    label: () => t('Search this space'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-f',
    run: (context) => searchFrom(context.view),
  },
  {
    id: 'app.refresh',
    label: () => t('Reload'),
    category: 'view',
    scope: 'app',
    key: null,
    run: () =>
      void import('../refresh').then(({ refreshHere }) => refreshHere()).catch(() => undefined),
  },
  {
    id: 'app.links',
    label: () => t('Links'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-b',
    run: () => revealPanel('links'),
  },
  ...(__EVEN_PLUGIN__
    ? []
    : [
        {
          id: 'app.tasks',
          label: () => t('Tasks'),
          category: 'view',
          scope: 'app',
          key: 'Mod-Shift-y',
          run: () => void import('../todos-entry').then(({ showTodos }) => showTodos()),
        } satisfies Shortcut,
        {
          id: 'app.chats',
          label: () => t('Chats'),
          category: 'view',
          scope: 'app',
          key: 'Mod-Shift-u',
          run: () => revealPanel('chats'),
        } satisfies Shortcut,
        {
          id: 'app.time',
          label: () => t('Time tracker'),
          category: 'view',
          scope: 'app',
          key: null,
          run: () => revealPanel('time'),
        } satisfies Shortcut,
        {
          id: 'time.start',
          label: () => t('Start timer'),
          category: 'view',
          scope: 'app',
          key: null,
          run: () => void import('../time/commands').then(({ startTimer }) => startTimer()),
        } satisfies Shortcut,
        {
          id: 'time.stop',
          label: () => t('Stop timer'),
          category: 'view',
          scope: 'app',
          key: null,
          run: () => void import('../time/commands').then(({ stopTimer }) => stopTimer()),
        } satisfies Shortcut,
        {
          id: 'chat.jump-new',
          label: () => t('New'),
          category: 'view',
          scope: 'panel',
          key: 'Mod-j',
          contextual: true,
        } satisfies Shortcut,
        {
          id: 'chat.record',
          label: () => t('Voice message'),
          category: 'view',
          scope: 'panel',
          key: 'Mod-Shift-m',
          contextual: true,
        } satisfies Shortcut,
        {
          id: 'chat.search',
          label: () => t('Search this chat'),
          category: 'view',
          scope: 'panel',
          key: 'Mod-f',
          contextual: true,
        } satisfies Shortcut,
      ]),
  {
    id: 'app.ask',
    label: () => t('Ask'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-a',
    run: () => {
      if (!askAgain?.()) revealPanel('ask')
    },
  },
  {
    id: 'app.ask-selection',
    label: () => t('Selection to the AI panel'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-k',
    run: () => {
      if (!__EVEN_PLUGIN__) void import('../ai/sidebar/quote').then((one) => one.quoteSelection())
    },
  },
  {
    id: 'app.quick-question',
    label: () => t('Quick question'),
    category: 'view',
    scope: 'app',
    key: 'Mod Mod',
    run: () => askQuickly(),
  },
  {
    id: 'app.scratchpad',
    label: () => t('Scratchpad'),
    category: 'view',
    scope: 'app',
    key: 'Mod-n',
    run: () => toggleScratchpad(),
  },
  {
    id: 'app.scratchpad.alt',
    label: () => t('Scratchpad'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-x',
    alias: true,
    run: () => toggleScratchpad(),
  },
  {
    id: 'agents.stop',
    label: () => t('Stop agents'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-Shift-k',
    mac: 'Mod-Ctrl-Alt-k',
    run: () => {
      if (!__EVEN_PLUGIN__) void import('../agents/ui/index').then(({ stopAgents }) => stopAgents())
    },
    desktop: true,
  },
  {
    id: 'app.region-next',
    label: () => t('Next section'),
    category: 'view',
    scope: 'app',
    key: 'F6',
    run: () => void stepRegionFocus(1),
  },
  {
    id: 'app.region-previous',
    label: () => t('Previous section'),
    category: 'view',
    scope: 'app',
    key: 'Shift-F6',
    run: () => void stepRegionFocus(-1),
  },
  {
    id: 'space.previous',
    label: () => t('Previous space'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-,',
    run: () => stepSpace(-1),
  },
  {
    id: 'space.next',
    label: () => t('Next space'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-.',
    run: () => stepSpace(1),
  },
  {
    id: 'space.switcher',
    label: () => t('Spaces'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Space',
    mac: 'Mod-Shift-Space',
    run: toggleSpacePicker,
  },
  {
    id: 'space.switcher.alt',
    label: () => t('Spaces'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Space',
    mac: null,
    alias: true,
    run: toggleSpacePicker,
  },
  {
    id: 'app.explorer',
    label: () => t('File explorer'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-e',
    desktop: true,
    run: () => {
      if (!__EVEN_PLUGIN__ && hiddenKinds.offers('explorer'))
        void import('../explorer/open').then((one) => one.openExplorer())
    },
  },
  {
    id: 'app.graph',
    label: () => t('Graph'),
    category: 'view',
    scope: 'app',
    key: null,
    run: () => workspace.openGraph(),
  },
  {
    id: 'app.source',
    label: () => t('Source mode'),
    category: 'view',
    scope: 'app',
    key: 'Mod-/',
    run: (context) => modes.toggleSource(context.view),
  },
  {
    id: 'app.focus',
    label: () => t('Focus mode'),
    category: 'view',
    scope: 'app',
    key: 'F8',
    mac: 'Mod-Ctrl-o',
    run: (context) => modes.toggleFocus(context.view),
  },
  {
    id: 'app.typewriter',
    label: () => t('Typewriter mode'),
    category: 'view',
    scope: 'app',
    key: 'F9',
    mac: 'Mod-Ctrl-t',
    run: (context) => modes.toggleTypewriter(context.view),
  },
  {
    id: 'app.reading',
    label: () => t('Reading'),
    category: 'view',
    scope: 'app',
    key: 'Mod-e',
    run: () => workspace.toggleReading(),
  },
  {
    id: 'app.present',
    label: () => t('Present'),
    category: 'view',
    scope: 'app',
    key: 'F5',
    mac: 'Mod-Alt-p',
    run: () => present.toggle(),
  },
  {
    id: 'app.read-only',
    label: () => t('Read-only'),
    category: 'view',
    scope: 'app',
    key: 'F10',
    mac: 'Mod-Ctrl-r',
    run: (context) => modes.toggleReadOnly(context.view),
  },
  {
    id: 'app.fullscreen',
    label: () => t('Fullscreen'),
    category: 'view',
    scope: 'app',
    key: 'F11',
    mac: 'Mod-Ctrl-f',
    run: (context) => context.fullscreen(),
  },
  {
    id: 'app.fill-tab',
    label: () => t('Full window'),
    category: 'view',
    scope: 'app',
    key: 'Shift-F11',
    mac: 'Mod-Ctrl-Shift-f',
    run: () => void import('../tab-fill/fill').then((one) => one.toggleFill()),
  },
  {
    id: 'app.zoom-in',
    label: () => t('Zoom in'),
    category: 'view',
    scope: 'app',
    key: 'Mod-=',
    run: () => workspace.zoomPage('in') || modes.stepZoom(1),
  },
  {
    id: 'app.zoom-out',
    label: () => t('Zoom out'),
    category: 'view',
    scope: 'app',
    key: 'Mod--',
    run: () => workspace.zoomPage('out') || modes.stepZoom(-1),
  },
  {
    id: 'app.zoom-reset',
    label: () => t('Actual size'),
    category: 'view',
    scope: 'app',
    key: 'Mod-0',
    run: () => workspace.zoomPage('reset') || modes.resetZoom(),
  },
]

const LAST = 8

const noteAt = (index: number) => t('Note {number}', { number: index + 1 })

const NUMBERED: Shortcut[] = Array.from({ length: 9 }, (_unused, index) => ({
  id: `app.note-${index + 1}`,
  label: () => (index === LAST ? t('Last note') : noteAt(index)),
  category: 'view' as const,
  scope: 'app' as const,
  key: `Mod-Alt-${index + 1}`,
  mac: `Mod-${index + 1}`,
  run: () => showTab(index === LAST ? 'last' : index),
}))

const ALT_NUMBERED: Shortcut[] = Array.from({ length: 10 }, (_unused, index): Shortcut => {
  const digit = (index + 1) % 10
  const at = digit === 0 ? 'last' : index
  const ninth = at === LAST

  return {
    id: ninth ? 'app.note-ninth' : `app.note-${at === 'last' ? LAST + 1 : digit}.alt`,
    label: () => (at === 'last' ? t('Last note') : noteAt(at)),
    category: 'view',
    scope: 'app',
    key: `Alt-${digit}`,
    mac: null,
    ...(ninth ? {} : { alias: true }),
    run: () => showTab(at),
  }
})

export function showTab(at: number | 'last') {
  const tabs = workspace.tabsIn(workspace.panes.focusedId)
  const tab = at === 'last' ? tabs.at(-1) : tabs[at]
  if (tab) workspace.activate(tab.id)
}

const PANEL_ENTRIES: Shortcut[] = [
  {
    id: 'tree.select-all',
    label: () => t('Select every file'),
    category: 'panel',
    scope: 'panel',
    key: 'Mod-a',
    contextual: true,
  },
  {
    id: 'tree.deselect',
    label: () => t('Clear the selection'),
    category: 'panel',
    scope: 'panel',
    key: 'Escape',
    contextual: true,
  },
  {
    id: 'tree.delete',
    label: () => t('Delete the selected files'),
    category: 'panel',
    scope: 'panel',
    key: 'Delete',
    mac: 'Mod-Backspace',
    contextual: true,
  },
  {
    id: 'tree.delete.alt',
    label: () => t('Delete the selected files'),
    category: 'panel',
    scope: 'panel',
    key: 'Backspace',
    mac: 'Mod-Delete',
    contextual: true,
    alias: true,
  },
  {
    id: 'tree.down',
    label: () => t('Next file'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowDown',
    contextual: true,
  },
  {
    id: 'tree.up',
    label: () => t('Previous file'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.into',
    label: () => t('Show what it holds'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowRight',
    contextual: true,
  },
  {
    id: 'tree.out',
    label: () => t('Hide what it holds'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowLeft',
    contextual: true,
  },
  {
    id: 'tree.open',
    label: () => t('Open'),
    category: 'panel',
    scope: 'panel',
    key: 'Enter',
    contextual: true,
  },
  {
    id: 'tree.rename',
    label: () => t('Rename'),
    category: 'panel',
    scope: 'panel',
    key: 'F2',
    mac: 'Mod-Enter',
    contextual: true,
  },
  {
    id: 'tree.extend-down',
    label: () => t('Select down'),
    category: 'panel',
    scope: 'panel',
    key: 'Shift-ArrowDown',
    contextual: true,
  },
  {
    id: 'tree.extend-up',
    label: () => t('Select up'),
    category: 'panel',
    scope: 'panel',
    key: 'Shift-ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.toggle',
    label: () => t('Select or deselect'),
    category: 'panel',
    scope: 'panel',
    key: 'Mod-Shift-Enter',
    contextual: true,
  },
  {
    id: 'tree.duplicate',
    label: () => t('Duplicate'),
    category: 'panel',
    scope: 'panel',
    key: null,
    contextual: true,
  },
  {
    id: 'tree.move-up',
    label: () => t('Move up'),
    category: 'panel',
    scope: 'panel',
    key: 'Alt-ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.move-down',
    label: () => t('Move down'),
    category: 'panel',
    scope: 'panel',
    key: 'Alt-ArrowDown',
    contextual: true,
  },
  {
    id: 'list.menu',
    label: () => t('Menu for this row'),
    category: 'panel',
    scope: 'panel',
    key: 'Shift-F10',
    contextual: true,
  },
  {
    id: 'list.menu.alt',
    label: () => t('Menu for this row'),
    category: 'panel',
    scope: 'panel',
    key: 'ContextMenu',
    contextual: true,
    alias: true,
  },
]

const CANVAS_ENTRIES: Shortcut[] = (
  [
    ['canvas.tool.select', () => t('Select'), 'v'],
    ['canvas.tool.hand', () => t('Pan'), 'h'],
    ['canvas.tool.draw', () => t('Draw'), 'd'],
    ['canvas.tool.erase', () => t('Erase'), 'e'],
    ['canvas.tool.lasso', () => t('Lasso'), 'q'],
    ['canvas.tool.text', () => t('Card'), 'c'],
    ['canvas.tool.words', () => t('Text'), 'w'],
    ['canvas.tool.file', () => t('Note'), 'n'],
    ['canvas.tool.picture', () => t('Picture'), 'i'],
    ['canvas.tool.link', () => t('Link'), 'k'],
    ['canvas.tool.group', () => t('Frame'), 'f'],
    ['canvas.tool.rect', () => t('Rectangle'), 'r'],
    ['canvas.tool.ellipse', () => t('Oval'), 'o'],
    ['canvas.tool.rhombus', () => t('Diamond'), 'm'],
    ['canvas.tool.triangle', () => t('Triangle'), 't'],
    ['canvas.tool.line', () => t('Line'), 'l'],
    ['canvas.tool.arrow', () => t('Arrow'), 'a'],
    ['canvas.tool.elbow', () => t('Elbow'), 'b'],
    ['canvas.write', () => t('Write in what is picked'), 'Enter'],
    ['canvas.group', () => t('Group'), 'g'],
    ['canvas.ungroup', () => t('Ungroup'), 'u'],
    ['canvas.delete', () => t('Delete what is picked'), 'Delete'],
    ['canvas.duplicate', () => t('Duplicate'), 'Mod-d'],
    ['canvas.fit', () => t('Fit the canvas'), 'Mod-Alt-0'],
    ['canvas.zoom.in', () => t('Zoom in'), 'Mod-Alt-='],
    ['canvas.zoom.out', () => t('Zoom out'), 'Mod-Alt--'],
    ['canvas.zoom.actual', () => t('Actual size'), null],
    ['canvas.upright', () => t('Turn upright'), 'Mod-Alt-r'],
    ['canvas.frame', () => t('Zoom to what is picked'), 'Mod-1'],
    ['canvas.find', () => t('Find on the canvas'), 'Mod-f'],
    ['canvas.front', () => t('Bring to front'), 'Mod-Shift-]'],
    ['canvas.forward', () => t('Bring forward'), 'Mod-]'],
    ['canvas.back', () => t('Send to back'), 'Mod-Shift-['],
    ['canvas.backward', () => t('Send backward'), 'Mod-['],
    ['canvas.nudge.left', () => t('Nudge left'), 'ArrowLeft'],
    ['canvas.nudge.right', () => t('Nudge right'), 'ArrowRight'],
    ['canvas.nudge.up', () => t('Nudge up'), 'ArrowUp'],
    ['canvas.nudge.down', () => t('Nudge down'), 'ArrowDown'],
  ] as const
).map(([id, label, key]) => ({
  id,
  label,
  category: 'canvas' as const,
  scope: 'panel' as const,
  key,
  contextual: true,
}))

const PAGES_ENTRIES: Shortcut[] = (
  [
    ['pages.zoom.in', () => t('Zoom in'), 'Mod-Alt-='],
    ['pages.zoom.out', () => t('Zoom out'), 'Mod-Alt--'],
    ['pages.fit', () => t('Fit width'), 'Mod-Alt-0'],
    ['pages.fit.page', () => t('Fit page'), null],
    ['pages.add', () => t('Add a page'), null],
  ] as const
).map(([id, label, key]) => ({
  id,
  label,
  category: 'pages' as const,
  scope: 'panel' as const,
  key,
  contextual: true,
}))

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
    ['web.address.alt', () => t('Address'), 'Alt-d', null],
    ['web.reload', () => t('Reload'), 'F5', 'Mod-r'],
    ['web.reload.alt', () => t('Reload'), 'Mod-r', null],
    ['web.fresh', () => t('Hard reload'), 'Mod-Shift-r', undefined],
    ['web.fresh.alt', () => t('Hard reload'), 'Mod-F5', null],
    ['web.stop', () => t('Stop'), 'Escape', undefined],
    ['web.back', () => t('Back'), null, 'Mod-['],
    ['web.forward', () => t('Forward'), null, 'Mod-]'],
  ] as const
).map(([id, label, key, mac]) => ({
  id,
  label,
  category: 'view' as const,
  scope: 'panel' as const,
  key,
  ...(mac === undefined ? {} : { mac }),
  contextual: true,
  ...(id.endsWith('.alt') ? { alias: true } : {}),
}))

const AI_ENTRIES: Shortcut[] = (
  [
    ['ai.mode', () => t('Next mode'), 'Shift-Tab'],
    ['ai.model', () => t('Model and effort'), 'Alt-p'],
    ['ai.effort', () => t('Next effort'), 'Alt-t'],
    ['ai.steer', () => t('Send into the running answer'), 'Mod-Enter'],
    ['ai.stop', () => t('Stop the answer'), 'Escape'],
    ['ai.unfold', () => t('Open every step'), 'Mod-o'],
    ['ai.new', () => t('New chat'), 'Mod-n'],
  ] as const
).map(([id, label, key]) => ({
  id,
  label,
  category: 'view' as const,
  scope: 'panel' as const,
  key,
  contextual: true,
}))

const FIELD_ENTRIES: Shortcut[] = [
  {
    id: 'field.dictate',
    label: () => t('Dictate'),
    category: 'edit',
    scope: 'panel',
    key: 'Alt-v',
    contextual: true,
  },
]

CANVAS_ENTRIES.push({
  id: 'canvas.delete.alt',
  label: () => t('Delete what is picked'),
  category: 'canvas',
  scope: 'panel',
  key: 'Backspace',
  contextual: true,
  alias: true,
})

function toggleSpacePicker() {
  void import('../space-picker.svelte').then(({ spacePicker }) => spacePicker.toggle())
}

const tabOps = () => import('../tab-strip/ops')

let cycling: typeof import('../tab-cycle.svelte') | null = null

function cycleTab(direction: number, mayUseOrder = false) {
  if (cycling) {
    cycling.cycleTab(direction, mayUseOrder)
    return
  }

  void import('../tab-cycle.svelte').then((one) => {
    cycling = one
    one.cycleTab(direction, mayUseOrder)
  })
}

function closeAroundActive(which: Around) {
  const id = workspace.activeTabId
  if (id) void workspace.closeAround(id, which)
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
  {
    id: 'fixed.cut',
    label: () => t('Cut'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-x',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.copy',
    label: () => t('Copy'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-c',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.paste',
    label: () => t('Paste'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-v',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.caret',
    label: () => t('Moving the caret'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('The arrow keys, Home, End, Page up and Page down belong to the text.'),
  },
  {
    id: 'fixed.delete',
    label: () => t('Deleting a character'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('Backspace and Delete belong to the text.'),
  },
  {
    id: 'fixed.newline',
    label: () => t('New line'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Enter',
    why: () => t('Enter closes a code block and carries a list on.'),
  },
  {
    id: 'fixed.tab',
    label: () => t('Indent with Tab'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Tab',
    why: () => t('Tab moves on through the app as well as indenting.'),
  },
  {
    id: 'fixed.escape',
    label: () => t('Escape'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Escape',
    why: () => t('Escape closes whatever is open.'),
  },
  {
    id: 'fixed.lists',
    label: () => t('Moving through a list'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('The arrow keys, Enter and Esc work whatever is open; they are not shortcuts.'),
  },
  {
    id: 'fixed.quit',
    label: () => t('Quit'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Alt-F4',
    mac: 'Mod-q',
    why: () => t('Your system takes this key before the app sees it.'),
  },
]

const EXPLORER_ENTRIES: Shortcut[] = (
  [
    ['explorer.parent', () => t('Folder above'), 'Backspace', 'Mod-ArrowUp'],
    ['explorer.parent.alt', () => t('Folder above'), 'Alt-ArrowUp', 'Alt-ArrowUp'],
    ['explorer.location', () => t('Type a location'), 'Mod-l', 'Mod-Shift-g'],
    ['explorer.hidden', () => t('Hidden files'), 'Mod-h', 'Mod-Shift-h'],
    ['explorer.new-folder', () => t('New folder'), 'Mod-Shift-n', 'Mod-Shift-n'],
    ['explorer.delete', () => t('Delete for good'), 'Shift-Delete', 'Mod-Alt-Backspace'],
    ['explorer.filter', () => t('Filter'), 'Mod-f', 'Mod-f'],
    ['explorer.search', () => t('Search below this folder'), 'Mod-Shift-f', 'Mod-Shift-f'],
    ['explorer.look', () => t('Quick look'), 'Space', 'Space'],
    ['explorer.preview', () => t('Preview'), 'Alt-p', 'Mod-Alt-p'],
    ['explorer.list', () => t('List'), 'Mod-1', 'Mod-1'],
    ['explorer.grid', () => t('Grid'), 'Mod-2', 'Mod-2'],
    ['explorer.columns', () => t('Columns'), 'Mod-3', 'Mod-3'],
  ] as const
).map(([id, label, key, mac]) => ({
  id,
  label,
  category: 'explorer' as const,
  scope: 'panel' as const,
  key,
  mac,
  contextual: true,
  ...(id.endsWith('.alt') ? { alias: true } : {}),
}))

export const SHORTCUTS: Shortcut[] = [
  ...APP_ENTRIES,
  ...NUMBERED,
  ...ALT_NUMBERED,
  ...EDITOR_SPECS.map(fromEditor),
  ...PANEL_ENTRIES,
  ...EXPLORER_ENTRIES,
  ...CANVAS_ENTRIES,
  ...PAGES_ENTRIES,
  ...WEB_ENTRIES,
  ...AI_ENTRIES,
  ...FIELD_ENTRIES,
  ...FIXED_ENTRIES,
]

export const BY_ID = new Map(SHORTCUTS.map((one) => [one.id, one]))

const EDITOR_BY_ID = new Map(EDITOR_SPECS.map((one) => [one.id, one]))

export function runEntry(id: string, context: AppContext): boolean {
  const spec = EDITOR_BY_ID.get(id)
  if (spec) {
    const view = context.view
    if (!view) return false

    spec.run(view)
    view.focus()
    return true
  }

  const entry = BY_ID.get(id)
  if (entry?.scope !== 'app' || !entry.run) return false

  entry.run(context)
  return true
}

export function runnable(id: string): boolean {
  if (EDITOR_BY_ID.has(id)) return true

  const entry = BY_ID.get(id)
  return !!entry && entry.scope === 'app' && !!entry.run && (isDesktop || !entry.desktop)
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
