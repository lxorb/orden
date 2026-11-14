import { privateWindows } from '../web-tab/src/api'
import {
  type BindingSpec,
  type EditorView,
  imageBindings,
  ordenBindings,
  standardBindings,
  tableBindings,
} from '@orden/editor'
import { type ExportId, EXPORT_KEYS, labelOf } from '../export-formats/src/api'
import { revealPanel, stepRegionFocus } from '../focus'
import { modes } from '../modes.svelte'
import { searchFrom } from '../search.svelte'
import { askQuickly } from '../ai/quick-door'
import { showQuickAdd, toggleTabOverview } from '../surfaces.svelte'
import { toggleScratchpad } from '../scratchpad/src/api'
import { chatsOn, hiddenKinds, passOn, settings, timeOn } from '../settings.svelte'
import { stepSpace } from '../space-actions'
import { picks } from '../tab-strip/drag.svelte'
import { closeWindow, invoke, isDesktop, platform } from '../platform/src/api'
import type { Platform } from '../ui-kit/src/api'
import { workspace } from '../workspace.svelte'
import type { Toward } from '../workspace/pane-tree'
import { type Around, closeAfterLabel } from '../workspace/closing-around'
import type { UsageVia } from '@orden/sync-core'
import { ran } from '../usage/src/api'

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

const EDITOR_ENTRIES: Record<string, [Category, () => string]> = {
  'format.bold': ['format', () => 'Bold'],
  'format.italic': ['format', () => 'Italic'],
  'format.underline': ['format', () => 'Underline'],
  'format.code': ['format', () => 'Code'],
  'format.strikethrough': ['format', () => 'Strikethrough'],
  'format.highlight': ['format', () => 'Highlight'],
  'format.link': ['format', () => 'Link'],
  'format.image': ['format', () => 'Image'],
  'format.clear': ['format', () => 'Clear formatting'],
  'format.comment': ['format', () => 'Comment'],

  'paragraph.body': ['paragraph', () => 'Paragraph'],
  'paragraph.heading-1': ['paragraph', () => 'Heading 1'],
  'paragraph.heading-2': ['paragraph', () => 'Heading 2'],
  'paragraph.heading-3': ['paragraph', () => 'Heading 3'],
  'paragraph.heading-4': ['paragraph', () => 'Heading 4'],
  'paragraph.heading-5': ['paragraph', () => 'Heading 5'],
  'paragraph.heading-6': ['paragraph', () => 'Heading 6'],
  'paragraph.heading-up': ['paragraph', () => 'One heading level up'],
  'paragraph.heading-down': ['paragraph', () => 'One heading level down'],
  'paragraph.table': ['paragraph', () => 'Table'],
  'paragraph.code-block': ['paragraph', () => 'Code block'],
  'paragraph.math-block': ['paragraph', () => 'Math block'],
  'paragraph.chart': ['paragraph', () => 'Chart'],
  'paragraph.quote': ['paragraph', () => 'Quote'],
  'paragraph.ordered-list': ['paragraph', () => 'Numbered list'],
  'paragraph.bullet-list': ['paragraph', () => 'Bulleted list'],
  'paragraph.rule': ['paragraph', () => 'Horizontal rule'],
  'paragraph.task-list': ['paragraph', () => 'Task list'],
  'paragraph.task': ['paragraph', () => 'Tick the task'],
  'paragraph.callout': ['paragraph', () => 'Callout'],
  'paragraph.footnote': ['paragraph', () => 'Footnote'],
  'paragraph.toc': ['paragraph', () => 'Table of contents'],

  'view.fold': ['view', () => 'Fold'],
  'view.fold-all': ['view', () => 'Fold everything'],
  'view.fold-more': ['view', () => 'Fold more'],
  'view.fold-less': ['view', () => 'Fold less'],
  'view.unfold-all': ['view', () => 'Unfold everything'],

  'edit.indent': ['edit', () => 'Indent'],
  'edit.outdent': ['edit', () => 'Outdent'],
  'edit.run-fence': ['edit', () => 'Run this code block'],
  'edit.select-word': ['edit', () => 'Select the word, then the next'],
  'edit.select-line': ['edit', () => 'Select the line'],
  'edit.select-all-occurrences': ['edit', () => 'Select every one like it'],
  'edit.expand-selection': ['edit', () => 'Expand the selection'],
  'edit.shrink-selection': ['edit', () => 'Shrink the selection'],
  'edit.cursor-above': ['edit', () => 'Add a cursor above'],
  'edit.cursor-below': ['edit', () => 'Add a cursor below'],
  'edit.copy-markdown': ['edit', () => 'Copy as markdown'],
  'edit.paste-plain': ['edit', () => 'Paste as plain text'],
  'edit.undo': ['edit', () => 'Undo'],
  'edit.redo': ['edit', () => 'Redo'],
  'edit.redo.alt': ['edit', () => 'Redo'],
  'edit.select-all': ['edit', () => 'Select all'],
  'edit.find': ['edit', () => 'Find'],
  'edit.replace': ['edit', () => 'Replace'],
  'edit.find-next': ['edit', () => 'Find next'],
  'edit.find-next.alt': ['edit', () => 'Find next'],
  'edit.find-previous': ['edit', () => 'Find previous'],
  'edit.find-previous.alt': ['edit', () => 'Find previous'],
  'edit.goto-line': ['edit', () => 'Go to line'],
  'edit.move-line-up': ['edit', () => 'Move the line up'],
  'edit.move-line-down': ['edit', () => 'Move the line down'],
  'edit.copy-line-up': ['edit', () => 'Copy the line up'],
  'edit.copy-line-down': ['edit', () => 'Copy the line down'],
  'edit.insert-line-above': ['edit', () => 'Insert a line above'],
  'edit.delete-line': ['edit', () => 'Delete the line'],
  'edit.join-lines': ['edit', () => 'Join the lines'],
  'edit.sort-lines': ['edit', () => 'Sort the lines'],
  'edit.reverse-lines': ['edit', () => 'Reverse the lines'],
  'edit.upper-case': ['edit', () => 'Upper case'],
  'edit.lower-case': ['edit', () => 'Lower case'],
  'edit.title-case': ['edit', () => 'Title case'],
  'edit.duplicate-block': ['edit', () => 'Duplicate the block'],
  'edit.move-block-up': ['edit', () => 'Move the block up'],
  'edit.move-block-down': ['edit', () => 'Move the block down'],
  'edit.follow-link': ['edit', () => 'Follow the link'],

  'table.below': ['table', () => 'Into the table below'],
  'table.above': ['table', () => 'Into the table above'],
  'table.ahead': ['table', () => 'Forward into the table'],
  'table.behind': ['table', () => 'Back into the table'],
  'table.delete': ['table', () => 'Forward into the table instead of deleting'],
  'table.backspace': ['table', () => 'Back into the table instead of deleting'],

  'image.select-behind': ['picture', () => 'Select the picture behind'],
  'image.select-ahead': ['picture', () => 'Select the picture ahead'],
  'image.edit': ['picture', () => 'Edit the picture’s markdown'],
  'image.leave': ['picture', () => 'Leave the selected picture'],
  'image.step-up': ['picture', () => 'Step off the picture upwards'],
  'image.step-down': ['picture', () => 'Step off the picture downwards'],
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
  ['left', 'h', () => 'Pane to the left'],
  ['down', 'j', () => 'Pane below'],
  ['up', 'k', () => 'Pane above'],
  ['right', 'l', () => 'Pane to the right'],
]

const APP_ENTRIES: Shortcut[] = [
  {
    id: 'app.new',
    label: () => 'New note',
    category: 'file',
    scope: 'app',
    key: 'Mod-Alt-n',
    run: () => {
      if (hiddenKinds.offers('note')) workspace.openBlank()
    },
  },
  {
    id: 'app.new-kind',
    label: () => 'New tab',
    category: 'file',
    scope: 'app',
    key: 'Mod-t',
    run: () => workspace.newTab(),
  },
  {
    id: 'app.new-window',
    label: () => 'New window',
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void invoke('new_window').catch(() => undefined),
    desktop: true,
  },
  {
    id: 'app.new-private',
    label: () => 'New private tab',
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-n',
    run: () => {
      if (hiddenKinds.offers('private')) void privateWindows().then((one) => one.openPrivate())
    },
    desktop: true,
  },
  {
    id: 'app.random-note',
    label: () => 'Random note',
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void import('../random-note').then(({ openRandomNote }) => openRandomNote()),
  },
  {
    id: 'app.close',
    label: () => 'Close note',
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
    label: () => 'Close window',
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-w',
    run: () => void closeWindow(),
    desktop: true,
  },
  {
    id: 'app.back',
    label: () => 'Back',
    category: 'view',
    scope: 'app',
    key: 'Alt-ArrowLeft',
    mac: 'Ctrl-[',
    run: () => workspace.goBack(),
  },
  {
    id: 'web.address',
    label: () => 'Address',
    category: 'view',
    scope: 'panel',
    key: 'Mod-l',
    contextual: true,
  },
  {
    id: 'web.devtools',
    label: () => 'Developer tools',
    category: 'view',
    scope: 'panel',
    key: 'F12',
    contextual: true,
  },
  {
    id: 'web.devtools.alt',
    label: () => 'Developer tools',
    category: 'view',
    scope: 'panel',
    key: 'Mod-Shift-i',
    mac: 'Mod-Alt-i',
    contextual: true,
    alias: true,
  },
  {
    id: 'web.history',
    label: () => 'History',
    category: 'view',
    scope: 'panel',
    key: 'Mod-h',
    mac: 'Mod-y',
    contextual: true,
  },
  {
    id: 'web.clear-data',
    label: () => 'Delete browsing data',
    category: 'view',
    scope: 'panel',
    key: 'Mod-Shift-Delete',
    mac: 'Mod-Shift-Backspace',
    contextual: true,
  },
  {
    id: 'web.mute',
    label: () => 'Mute site',
    category: 'view',
    scope: 'panel',
    key: null,
    contextual: true,
  },
  {
    id: 'app.forward',
    label: () => 'Forward',
    category: 'view',
    scope: 'app',
    key: 'Alt-ArrowRight',
    mac: 'Ctrl-]',
    run: () => workspace.goForward(),
  },
  {
    id: 'app.reopen',
    label: () => 'Reopen closed tab',
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
    label: () => 'Close all tabs',
    category: 'file',
    scope: 'app',
    key: null,
    run: () => closeAroundActive('all'),
  },
  {
    id: 'app.duplicate-tab',
    label: () => 'Duplicate tab',
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void tabOps().then((ops) => ops.duplicateTab(workspace.activeTabId ?? '')),
  },
  {
    id: 'app.settings',
    label: () => 'Settings',
    category: 'file',
    scope: 'app',
    key: 'Mod-,',
    run: () => settings.show(),
  },
  {
    id: 'app.keys',
    label: () => 'Keyboard shortcuts',
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-/',
    mac: null,
    run: () => settings.show('shortcuts'),
  },
  {
    id: 'app.print',
    label: () => 'Print',
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
    label: () => 'Next note',
    category: 'view',
    scope: 'app',
    key: 'Mod-Tab',
    mac: 'Ctrl-Tab',
    run: () => cycleTab(1, true),
  },
  {
    id: 'app.previous-note',
    label: () => 'Previous note',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Tab',
    mac: 'Ctrl-Shift-Tab',
    run: () => cycleTab(-1, true),
  },
  {
    id: 'app.next-note.alt',
    label: () => 'Next note',
    category: 'view',
    scope: 'app',
    key: 'Mod-PageDown',
    mac: 'Mod-Shift-]',
    alias: true,
    run: () => cycleTab(1),
  },
  {
    id: 'app.previous-note.alt',
    label: () => 'Previous note',
    category: 'view',
    scope: 'app',
    key: 'Mod-PageUp',
    mac: 'Mod-Shift-[',
    alias: true,
    run: () => cycleTab(-1),
  },
  {
    id: 'app.move-tab-left',
    label: () => 'Move tab left',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-PageUp',
    run: () => moveTab(-1),
  },
  {
    id: 'app.move-tab-right',
    label: () => 'Move tab right',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-PageDown',
    run: () => moveTab(1),
  },
  {
    id: 'app.deselect-tab',
    label: () => 'Deselect tab',
    category: 'view',
    scope: 'app',
    key: 'Mod-d',
    run: () => workspace.deselect(),
  },
  {
    id: 'app.deselect-all',
    label: () => 'Deselect all tabs',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-d',
    run: () => workspace.deselectAll(),
  },
  {
    id: 'tabs.rename',
    label: () => 'Rename',
    category: 'view',
    scope: 'panel',
    key: 'F2',
    contextual: true,
  },
  {
    id: 'pane.split-right',
    label: () => 'Split right',
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-ArrowRight',
    run: () => workspace.split('row'),
  },
  {
    id: 'pane.split-down',
    label: () => 'Split down',
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-ArrowDown',
    run: () => workspace.split('column'),
  },
  {
    id: 'pane.move-tab',
    label: () => 'Move to other pane',
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-Shift-ArrowRight',
    run: () => void tabOps().then((ops) => ops.moveToOtherPane(workspace.activeTabId ?? '')),
  },
  {
    id: 'pane.focus-next',
    label: () => 'Other pane',
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
    label: () => 'Tabs',
    category: 'view',
    scope: 'app',
    key: 'Alt Alt',
    run: () => toggleTabOverview(),
  },
  {
    id: 'app.palette',
    label: () => 'Command palette',
    category: 'view',
    scope: 'app',
    key: 'Shift Shift',
    run: (context) => context.palette(undefined, context.tapped),
  },
  {
    id: 'app.palette.alt',
    label: () => 'Command palette',
    category: 'view',
    scope: 'app',
    key: null,
    alias: true,
    run: (context) => context.palette(undefined, context.tapped),
  },
  {
    id: 'app.palette.open',
    label: () => 'Command palette',
    category: 'view',
    scope: 'app',
    key: 'Mod-o',
    alias: true,
    run: (context) => context.palette(undefined, context.tapped),
  },
  {
    id: 'app.commands',
    label: () => 'Commands',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-p',
    run: (context) => context.palette('commands'),
  },
  {
    id: 'app.commands.alt',
    label: () => 'Commands',
    category: 'view',
    scope: 'app',
    key: null,
    alias: true,
    run: (context) => context.palette('commands'),
  },
  {
    id: 'app.quick-add',
    label: () => 'Add task',
    category: 'file',
    scope: 'app',
    key: 'Ctrl-Alt-Space',
    run: () => showQuickAdd(),
  },
  {
    id: 'tasks.quick-add',
    label: () => 'Add task',
    category: 'file',
    scope: 'panel',
    key: 'q',
    contextual: true,
    alias: true,
  },
  {
    id: 'app.sidebar',
    label: () => 'Left sidebar',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-l',
    run: () => workspace.toggleSidebar(),
  },
  {
    id: 'app.right-sidebar',
    label: () => 'Right sidebar',
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-b',
    run: () => workspace.toggleSidebar('right'),
  },
  {
    id: 'app.files',
    label: () => 'Files',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-e',
    run: () => revealPanel('tree'),
  },
  {
    id: 'app.reveal',
    label: () => 'Show in the file list',
    category: 'panel',
    scope: 'app',
    key: null,
    run: () => workspace.revealNote(),
  },
  {
    id: 'app.fold-list',
    label: () => 'Collapse the file list',
    category: 'panel',
    scope: 'app',
    key: null,
    run: () => workspace.foldList(),
  },
  {
    id: 'app.outline',
    label: () => 'Outline',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-o',
    run: () => revealPanel('outline'),
  },
  {
    id: 'app.search',
    label: () => 'Search this space',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-f',
    run: (context) => searchFrom(context.view),
  },
  {
    id: 'app.refresh',
    label: () => 'Reload',
    category: 'view',
    scope: 'app',
    key: null,
    run: () =>
      void import('../refresh').then(({ refreshHere }) => refreshHere()).catch(() => undefined),
  },
  {
    id: 'app.links',
    label: () => 'Links',
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
          label: () => 'Todos',
          category: 'view',
          scope: 'app',
          key: 'Mod-Shift-y',
          run: () => void import('../todos-entry').then(({ showTodos }) => showTodos()),
        } satisfies Shortcut,
        {
          id: 'app.chats',
          label: () => 'Chats',
          category: 'view',
          scope: 'app',
          key: 'Mod-Shift-u',
          shown: () => chatsOn(),
          run: () => revealPanel('chats'),
        } satisfies Shortcut,
        {
          id: 'app.time',
          label: () => 'Time tracker',
          category: 'view',
          scope: 'app',
          key: null,
          shown: () => timeOn(),
          run: () => revealPanel('time'),
        } satisfies Shortcut,
        {
          id: 'time.tab',
          label: () => 'Open time tracker',
          category: 'view',
          scope: 'app',
          key: null,
          shown: () => timeOn(),
          run: () => void import('../time/src/api').then(({ openTime }) => openTime()),
        } satisfies Shortcut,
        {
          id: 'time.start',
          label: () => 'Start timer',
          category: 'view',
          scope: 'app',
          key: null,
          shown: () => timeOn(),
          run: () => void import('../time/src/api').then(({ startTimer }) => startTimer()),
        } satisfies Shortcut,
        {
          id: 'time.stop',
          label: () => 'Stop timer',
          category: 'view',
          scope: 'app',
          key: null,
          shown: () => timeOn(),
          run: () => void import('../time/src/api').then(({ stopTimer }) => stopTimer()),
        } satisfies Shortcut,
        {
          id: 'chat.jump-new',
          label: () => 'New messages',
          category: 'view',
          scope: 'panel',
          key: 'Mod-j',
          contextual: true,
        } satisfies Shortcut,
        {
          id: 'chat.record',
          label: () => 'Voice message',
          category: 'view',
          scope: 'panel',
          key: 'Mod-Shift-m',
          contextual: true,
        } satisfies Shortcut,
        {
          id: 'chat.search',
          label: () => 'Search this chat',
          category: 'view',
          scope: 'panel',
          key: 'Mod-f',
          contextual: true,
        } satisfies Shortcut,
        {
          id: 'chat.members',
          label: () => 'Members',
          category: 'view',
          scope: 'panel',
          key: 'Mod-u',
          contextual: true,
        } satisfies Shortcut,
      ]),
  {
    id: 'app.ask',
    label: () => 'Ask',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-a',
    run: () => {
      if (!askAgain?.()) revealPanel('ask')
    },
  },
  {
    id: 'app.ask-selection',
    label: () => 'Selection to the AI panel',
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-k',
    run: () => {
      if (!__EVEN_PLUGIN__) void import('../ai/sidebar/quote').then((one) => one.quoteSelection())
    },
  },
  {
    id: 'app.quick-question',
    label: () => 'Quick question',
    category: 'view',
    scope: 'app',
    key: 'Mod Mod',
    run: () => askQuickly(),
  },
  {
    id: 'app.reload',
    label: () => 'Reload Orden',
    category: 'view',
    scope: 'app',
    key: 'Mod-r',
    run: () => location.reload(),
  },
  {
    id: 'app.scratchpad',
    label: () => 'Scratchpad',
    category: 'view',
    scope: 'app',
    key: 'Mod-n',
    run: () => toggleScratchpad(),
  },
  {
    id: 'app.scratchpad.alt',
    label: () => 'Scratchpad',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-x',
    alias: true,
    run: () => toggleScratchpad(),
  },
  {
    id: 'agents.stop',
    label: () => 'Stop agents',
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
    label: () => 'Next section',
    category: 'view',
    scope: 'app',
    key: 'F6',
    run: () => void stepRegionFocus(1),
  },
  {
    id: 'app.region-previous',
    label: () => 'Previous section',
    category: 'view',
    scope: 'app',
    key: 'Shift-F6',
    run: () => void stepRegionFocus(-1),
  },
  {
    id: 'space.previous',
    label: () => 'Previous space',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-,',
    run: () => stepSpace(-1),
  },
  {
    id: 'space.next',
    label: () => 'Next space',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-.',
    run: () => stepSpace(1),
  },
  {
    id: 'space.switcher',
    label: () => 'Spaces',
    category: 'view',
    scope: 'app',
    key: 'Mod-Space',
    mac: 'Mod-Shift-Space',
    run: toggleSpacePicker,
  },
  {
    id: 'space.switcher.alt',
    label: () => 'Spaces',
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Space',
    mac: null,
    alias: true,
    run: toggleSpacePicker,
  },
  {
    id: 'app.explorer',
    label: () => 'File explorer',
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-e',
    desktop: true,
    run: () => {
      if (!__EVEN_PLUGIN__ && hiddenKinds.offers('explorer'))
        void import('../explorer/src/api').then((one) => one.openExplorer())
    },
  },
  ...(__EVEN_PLUGIN__
    ? []
    : [
        {
          id: 'app.pass',
          label: () => 'Pass',
          category: 'view',
          scope: 'app',
          key: 'Mod-Alt-v',
          shown: () => passOn(),
          run: () => void import('../pass-sync/src/api').then((one) => one.openPass()),
        } satisfies Shortcut,
      ]),
  {
    id: 'app.graph',
    label: () => 'Graph',
    category: 'view',
    scope: 'app',
    key: null,
    run: () => workspace.openGraph(),
  },
  {
    id: 'app.source',
    label: () => 'Source mode',
    category: 'view',
    scope: 'app',
    key: 'Mod-/',
    run: (context) => modes.toggleSource(context.view),
  },
  {
    id: 'app.focus',
    label: () => 'Focus mode',
    category: 'view',
    scope: 'app',
    key: 'F8',
    mac: 'Mod-Ctrl-o',
    run: (context) => modes.toggleFocus(context.view),
  },
  {
    id: 'app.typewriter',
    label: () => 'Typewriter mode',
    category: 'view',
    scope: 'app',
    key: 'F9',
    mac: 'Mod-Ctrl-t',
    run: (context) => modes.toggleTypewriter(context.view),
  },
  {
    id: 'app.reading',
    label: () => 'Reading',
    category: 'view',
    scope: 'app',
    key: 'Mod-e',
    run: () => workspace.toggleReading(),
  },
  {
    id: 'app.read-only',
    label: () => 'Read-only',
    category: 'view',
    scope: 'app',
    key: 'F10',
    mac: 'Mod-Ctrl-r',
    run: (context) => modes.toggleReadOnly(context.view),
  },
  {
    id: 'app.fullscreen',
    label: () => 'Fullscreen',
    category: 'view',
    scope: 'app',
    key: 'F11',
    mac: 'Mod-Ctrl-f',
    run: (context) => context.fullscreen(),
  },
  {
    id: 'app.fill-tab',
    label: () => 'Full window',
    category: 'view',
    scope: 'app',
    key: 'Shift-F11',
    mac: 'Mod-Ctrl-Shift-f',
    run: () => void import('../tab-fill/src/api').then((one) => one.toggleFill()),
  },
  {
    id: 'app.zoom-in',
    label: () => 'Zoom in',
    category: 'view',
    scope: 'app',
    key: 'Mod-=',
    run: () => workspace.zoomPage('in') || modes.stepZoom(1),
  },
  {
    id: 'app.zoom-out',
    label: () => 'Zoom out',
    category: 'view',
    scope: 'app',
    key: 'Mod--',
    run: () => workspace.zoomPage('out') || modes.stepZoom(-1),
  },
  {
    id: 'app.zoom-reset',
    label: () => 'Actual size',
    category: 'view',
    scope: 'app',
    key: 'Mod-0',
    run: () => workspace.zoomPage('reset') || modes.resetZoom(),
  },
]

const LAST = 8

const noteAt = (index: number) => `Note ${index + 1}`

const NUMBERED: Shortcut[] = Array.from({ length: 9 }, (_unused, index) => ({
  id: `app.note-${index + 1}`,
  label: () => (index === LAST ? 'Last note' : noteAt(index)),
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
    label: () => (at === 'last' ? 'Last note' : noteAt(at)),
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
    label: () => 'Select every file',
    category: 'panel',
    scope: 'panel',
    key: 'Mod-a',
    contextual: true,
  },
  {
    id: 'tree.deselect',
    label: () => 'Clear the selection',
    category: 'panel',
    scope: 'panel',
    key: 'Escape',
    contextual: true,
  },
  {
    id: 'tree.delete',
    label: () => 'Delete the selected files',
    category: 'panel',
    scope: 'panel',
    key: 'Delete',
    mac: 'Mod-Backspace',
    contextual: true,
  },
  {
    id: 'tree.delete.alt',
    label: () => 'Delete the selected files',
    category: 'panel',
    scope: 'panel',
    key: 'Backspace',
    mac: 'Mod-Delete',
    contextual: true,
    alias: true,
  },
  {
    id: 'tree.down',
    label: () => 'Next file',
    category: 'panel',
    scope: 'panel',
    key: 'ArrowDown',
    contextual: true,
  },
  {
    id: 'tree.up',
    label: () => 'Previous file',
    category: 'panel',
    scope: 'panel',
    key: 'ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.into',
    label: () => 'Show what it holds',
    category: 'panel',
    scope: 'panel',
    key: 'ArrowRight',
    contextual: true,
  },
  {
    id: 'tree.out',
    label: () => 'Hide what it holds',
    category: 'panel',
    scope: 'panel',
    key: 'ArrowLeft',
    contextual: true,
  },
  {
    id: 'tree.open',
    label: () => 'Open',
    category: 'panel',
    scope: 'panel',
    key: 'Enter',
    contextual: true,
  },
  {
    id: 'tree.rename',
    label: () => 'Rename',
    category: 'panel',
    scope: 'panel',
    key: 'F2',
    mac: 'Mod-Enter',
    contextual: true,
  },
  {
    id: 'tree.extend-down',
    label: () => 'Select down',
    category: 'panel',
    scope: 'panel',
    key: 'Shift-ArrowDown',
    contextual: true,
  },
  {
    id: 'tree.extend-up',
    label: () => 'Select up',
    category: 'panel',
    scope: 'panel',
    key: 'Shift-ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.toggle',
    label: () => 'Select or deselect',
    category: 'panel',
    scope: 'panel',
    key: 'Mod-Shift-Enter',
    contextual: true,
  },
  {
    id: 'tree.duplicate',
    label: () => 'Duplicate',
    category: 'panel',
    scope: 'panel',
    key: null,
    contextual: true,
  },
  {
    id: 'tree.move-up',
    label: () => 'Move up',
    category: 'panel',
    scope: 'panel',
    key: 'Alt-ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.move-down',
    label: () => 'Move down',
    category: 'panel',
    scope: 'panel',
    key: 'Alt-ArrowDown',
    contextual: true,
  },
  {
    id: 'list.menu',
    label: () => 'Menu for this row',
    category: 'panel',
    scope: 'panel',
    key: 'Shift-F10',
    contextual: true,
  },
  {
    id: 'list.menu.alt',
    label: () => 'Menu for this row',
    category: 'panel',
    scope: 'panel',
    key: 'ContextMenu',
    contextual: true,
    alias: true,
  },
]

const CANVAS_ENTRIES: Shortcut[] = (
  [
    ['canvas.tool.select', () => 'Select', 'v'],
    ['canvas.tool.hand', () => 'Pan', 'h'],
    ['canvas.tool.draw', () => 'Draw', 'd'],
    ['canvas.tool.erase', () => 'Erase', 'e'],
    ['canvas.tool.lasso', () => 'Lasso', 'q'],
    ['canvas.tool.text', () => 'Card', 'c'],
    ['canvas.tool.words', () => 'Text', 'w'],
    ['canvas.tool.file', () => 'Note', 'n'],
    ['canvas.tool.picture', () => 'Picture', 'i'],
    ['canvas.tool.link', () => 'Link', 'k'],
    ['canvas.tool.group', () => 'Frame', 'f'],
    ['canvas.tool.rect', () => 'Rectangle', 'r'],
    ['canvas.tool.ellipse', () => 'Oval', 'o'],
    ['canvas.tool.rhombus', () => 'Diamond', 'm'],
    ['canvas.tool.triangle', () => 'Triangle', 't'],
    ['canvas.tool.line', () => 'Line', 'l'],
    ['canvas.tool.arrow', () => 'Arrow', 'a'],
    ['canvas.tool.elbow', () => 'Elbow', 'b'],
    ['canvas.write', () => 'Write in what is picked', 'Enter'],
    ['canvas.group', () => 'Group', 'g'],
    ['canvas.ungroup', () => 'Ungroup', 'u'],
    ['canvas.delete', () => 'Delete what is picked', 'Delete'],
    ['canvas.duplicate', () => 'Duplicate', 'Mod-d'],
    ['canvas.fit', () => 'Fit the canvas', 'Mod-Alt-0'],
    ['canvas.zoom.in', () => 'Zoom in', 'Mod-Alt-='],
    ['canvas.zoom.out', () => 'Zoom out', 'Mod-Alt--'],
    ['canvas.zoom.actual', () => 'Actual size', null],
    ['canvas.upright', () => 'Turn upright', 'Mod-Alt-r'],
    ['canvas.frame', () => 'Zoom to what is picked', 'Mod-1'],
    ['canvas.find', () => 'Find on the canvas', 'Mod-f'],
    ['canvas.front', () => 'Bring to front', 'Mod-Shift-]'],
    ['canvas.forward', () => 'Bring forward', 'Mod-]'],
    ['canvas.back', () => 'Send to back', 'Mod-Shift-['],
    ['canvas.backward', () => 'Send backward', 'Mod-['],
    ['canvas.nudge.left', () => 'Nudge left', 'ArrowLeft'],
    ['canvas.nudge.right', () => 'Nudge right', 'ArrowRight'],
    ['canvas.nudge.up', () => 'Nudge up', 'ArrowUp'],
    ['canvas.nudge.down', () => 'Nudge down', 'ArrowDown'],
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
    ['pages.zoom.in', () => 'Zoom in', 'Mod-Alt-='],
    ['pages.zoom.out', () => 'Zoom out', 'Mod-Alt--'],
    ['pages.fit', () => 'Fit width', 'Mod-Alt-0'],
    ['pages.fit.page', () => 'Fit page', null],
    ['pages.add', () => 'Add a page', null],
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
    ['web.address.alt', () => 'Address', 'Alt-d', null],
    ['web.reload', () => 'Reload', 'F5', 'Mod-r'],
    ['web.reload.alt', () => 'Reload', 'Mod-r', null],
    ['web.fresh', () => 'Hard reload', 'Mod-Shift-r', undefined],
    ['web.fresh.alt', () => 'Hard reload', 'Mod-F5', null],
    ['web.stop', () => 'Stop', 'Escape', undefined],
    ['web.back', () => 'Back', null, 'Mod-['],
    ['web.forward', () => 'Forward', null, 'Mod-]'],
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
    ['ai.mode', () => 'Next mode', 'Shift-Tab'],
    ['ai.model', () => 'Model and effort', 'Alt-p'],
    ['ai.effort', () => 'Next effort', 'Alt-t'],
    ['ai.steer', () => 'Send into the running answer', 'Mod-Enter'],
    ['ai.stop', () => 'Stop the answer', 'Escape'],
    ['ai.unfold', () => 'Open every step', 'Mod-o'],
    ['ai.new', () => 'New chat', 'Mod-n'],
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
    label: () => 'Dictate',
    category: 'edit',
    scope: 'panel',
    key: 'Alt-v',
    contextual: true,
  },
]

CANVAS_ENTRIES.push({
  id: 'canvas.delete.alt',
  label: () => 'Delete what is picked',
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
    label: () => 'Cut',
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-x',
    why: () => 'The clipboard belongs to the system.',
  },
  {
    id: 'fixed.copy',
    label: () => 'Copy',
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-c',
    why: () => 'The clipboard belongs to the system.',
  },
  {
    id: 'fixed.paste',
    label: () => 'Paste',
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-v',
    why: () => 'The clipboard belongs to the system.',
  },
  {
    id: 'fixed.caret',
    label: () => 'Moving the caret',
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => 'The arrow keys, Home, End, Page up and Page down belong to the text.',
  },
  {
    id: 'fixed.delete',
    label: () => 'Deleting a character',
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => 'Backspace and Delete belong to the text.',
  },
  {
    id: 'fixed.newline',
    label: () => 'New line',
    category: 'fixed',
    scope: 'fixed',
    key: 'Enter',
    why: () => 'Enter closes a code block and carries a list on.',
  },
  {
    id: 'fixed.tab',
    label: () => 'Indent with Tab',
    category: 'fixed',
    scope: 'fixed',
    key: 'Tab',
    why: () => 'Tab moves on through the app as well as indenting.',
  },
  {
    id: 'fixed.escape',
    label: () => 'Escape',
    category: 'fixed',
    scope: 'fixed',
    key: 'Escape',
    why: () => 'Escape closes whatever is open.',
  },
  {
    id: 'fixed.lists',
    label: () => 'Moving through a list',
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => 'The arrow keys, Enter and Esc work whatever is open; they are not shortcuts.',
  },
  {
    id: 'fixed.quit',
    label: () => 'Quit',
    category: 'fixed',
    scope: 'fixed',
    key: 'Alt-F4',
    mac: 'Mod-q',
    why: () => 'Your system takes this key before the app sees it.',
  },
]

const EXPLORER_ENTRIES: Shortcut[] = (
  [
    ['explorer.parent', () => 'Folder above', 'Backspace', 'Mod-ArrowUp'],
    ['explorer.parent.alt', () => 'Folder above', 'Alt-ArrowUp', 'Alt-ArrowUp'],
    ['explorer.location', () => 'Type a location', 'Mod-l', 'Mod-Shift-g'],
    ['explorer.hidden', () => 'Hidden files', 'Mod-h', 'Mod-Shift-h'],
    ['explorer.new-folder', () => 'New folder', 'Mod-Shift-n', 'Mod-Shift-n'],
    ['explorer.delete', () => 'Delete for good', 'Shift-Delete', 'Mod-Alt-Backspace'],
    ['explorer.filter', () => 'Filter', 'Mod-f', 'Mod-f'],
    ['explorer.search', () => 'Search below this folder', 'Mod-Shift-f', 'Mod-Shift-f'],
    ['explorer.look', () => 'Quick look', 'Space', 'Space'],
    ['explorer.preview', () => 'Preview', 'Alt-p', 'Mod-Alt-p'],
    ['explorer.list', () => 'List', 'Mod-1', 'Mod-1'],
    ['explorer.grid', () => 'Grid', 'Mod-2', 'Mod-2'],
    ['explorer.columns', () => 'Columns', 'Mod-3', 'Mod-3'],
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

const PASS_KEYS: readonly (readonly [string, () => string, string])[] = __EVEN_PLUGIN__
  ? []
  : [
      ['pass.search', () => 'Search Pass', 'Mod-f'],
      ['pass.new-login', () => 'New login', 'Mod-n'],
    ]

const PASS_ENTRIES: Shortcut[] = PASS_KEYS.map(([id, label, key]) => ({
  id,
  label,
  category: 'pass' as const,
  scope: 'panel' as const,
  key,
  contextual: true,
  shown: () => passOn(),
}))

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

export function runnable(id: string): boolean {
  if (EDITOR_BY_ID.has(id)) return true

  const entry = BY_ID.get(id)
  return (
    !!entry &&
    entry.scope === 'app' &&
    !!entry.run &&
    (isDesktop || !entry.desktop) &&
    entry.shown?.() !== false
  )
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
