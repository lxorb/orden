import { protection } from '../../protect/src/api'
import { copyNoteLink } from './link'
import {
  CODE_PALETTES,
  deleteLine,
  duplicateBlock,
  EditorView,
  expandSelection,
  findNext,
  findPrevious,
  foldHeadings,
  foldLess,
  foldMore,
  insertCallout,
  insertAiBlock,
  insertChart,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertPageBreak,
  insertTableToEdit,
  insertLineAbove,
  insertToc,
  joinLines,
  lowerCase,
  moveBlockDown,
  moveBlockUp,
  pastePlain,
  redoEdit,
  reformatDocument,
  reverseLines,
  selectWord,
  setHeading,
  shiftHeading,
  shrinkSelection,
  type SlashBlock,
  sortLines,
  type StateCommand,
  titleCase,
  toggleBulletList,
  toggleFold,
  toggleOrderedList,
  toggleQuote,
  toggleTaskList,
  toggleWrap,
  type Transaction,
  undoEdit,
  unfoldEverything,
  upperCase,
} from '@orden/editor'
import { account } from '../../accounts/src/api'
import { busy, prompt, viewport, type MenuItem, DIVIDER, fullscreen } from '../../ui-kit/src/api'
import { turnedOff, basesOn, type KindName, passOn, timeOn } from '../../gates/src/api'
import { composerCommands } from './composer-commands'
import { paletteName } from '../../highlight/src/api'
import { links } from '../../link-index/src/api'
import { canPrint, printable } from '../../export-formats/src/api'
import { canInsertPicture, canTakePhoto, insertPicture, takePhoto } from './insert-picture'
import { moveTargets } from '../../tree/src/api'
import { closeAfterLabel } from '../../panes/src/api'
import { revealPanel, workspace, agentMarks } from '../../workspace/src/api'
import { newSpace, publishSpace, shareSpace } from '../../spaces/src/api'
import {
  canPublish,
  canShare,
  canShareItem,
  canWriteAt,
  shareThisFile,
  lockAllEntry,
  protectEntries,
} from '../../sharing/src/api'
import { archiveEntry } from '../../row-menu/src/api'
import { updates, ISSUES_URL, RELEASES_URL, SOURCE_URL } from '../../updates/src/api'
import { modes, choices } from '../../modes/src/api'
import { runEntry, shortcuts } from '../../shortcuts/src/api'
import {
  internal,
  invoke,
  isDesktop,
  isNative,
  openExternal,
  isMarkdownPath,
  samePath,
} from '../../platform/src/api'
import { exportSpace } from '../../web-backend/src/api'
import { SCHEME_CHOICES, SCHEME_NAMES } from '../../theme-looks/src/api'
import { theme } from '../../theme/src/api'
import { isUnsaved } from '../../documents/src/api'
import { askPlace } from '../../save-place/src/api'
import { tabOps, tabToSpace } from '../../tab-strip/src/api'
import { openRandomNote, randomChoices } from './random-note'
import { showFeedback } from '../../surfaces/src/api'
import { commandRows, commandRowsLoaded, runCommand, settingsWindow } from '@orden/contracts'

async function openCustomCss() {
  if (!isNative) return

  const path = await invoke<string>('custom_css_path')
  await workspace.open(path)
}

async function openSnippets() {
  if (!isNative) return

  const path = await invoke<string>('snippets_path')
  await workspace.open(path)
}

export function paletteCommands(view?: EditorView): Command[] {
  const folded = new Set(commandRows('export', view).map((one) => one.id))
  folded.delete('page-setup')
  return appCommands(view).filter((one) => !folded.has(one.id))
}

const entry = (id: string, view?: EditorView) => () =>
  void runEntry(id, {
    view,
    palette: () => undefined,
    fullscreen: () => void fullscreen.toggle(workspace.panes),
  })

const keyed = (
  id: string,
  label: string,
  key: string,
  extra: Partial<Command> = {},
  view?: EditorView,
): Command => ({ id, label, hint: shortcuts.hint(key), run: entry(key, view), ...extra })

const commanded = (
  id: string,
  label: string,
  command: string,
  extra: Partial<Command> = {},
): Command => ({ id, label, run: () => void runCommand(command), ...extra })

function importCommands(): Command[] {
  if (__EVEN_PLUGIN__) return []

  const asked = (id: string) => () => {
    settingsWindow().show('import')
    void runCommand(id)
  }

  return [
    commanded('import', 'Import', 'import.show'),
    { id: 'import-obsidian', label: 'Import from Obsidian', run: asked('import.obsidian') },
    commanded('import-notion', 'Import from Notion', 'import.notion'),
    ...(isDesktop
      ? [{ id: 'import-zen', label: 'Import from Zen', run: asked('import.zen') }]
      : []),
  ]
}

async function openLog() {
  if (!isDesktop) return

  const path = await invoke<string>('log_dir')
  const { reveal } = await import('../../files-out/src/api')
  await reveal(path)
}

async function openThemesFolder() {
  if (!isDesktop) return

  const dir = await invoke<string>('theme_dir')
  const { reveal } = await import('../../files-out/src/api')
  await reveal(dir)
  await theme.reload()
}

export interface Command extends MenuItem {
  id: string
  also?: readonly string[]
  byHand?: boolean
  ownWindow?: boolean
}

function agentRows(): Command[] {
  if (__EVEN_PLUGIN__ || !agentMarks.heard) return []

  return [
    {
      id: 'agents',
      label: 'Agents',
      run: () => {
        revealPanel('ask')
        void runCommand('ai.threads')
      },
    },
    keyed('agents-stop', 'Stop agents', 'agents.stop', { ownWindow: true }),
  ]
}

function protectCommands(): Command[] {
  return [...protectEntries(workspace.active?.path), ...lockAllEntry()].map((row) => ({
    ...row,
    id: `protect.${row.id}`,
    ownWindow: true,
  }))
}

function archiveCommand(): Command[] {
  return archiveEntry(workspace.active?.path).flatMap((entry) =>
    entry === DIVIDER ? [] : [{ id: 'archive', label: entry.label, run: entry.run }],
  )
}

function tabCommands(): Command[] {
  const id = workspace.activeTabId ?? ''
  const tab = workspace.active

  return [
    {
      id: 'close-right',
      label: closeAfterLabel(),
      hint: shortcuts.hint('app.close-right'),
      disabled: workspace.closesAround(id, 'right') === 0,
      run: () => void workspace.closeAround(id, 'right'),
    },
    {
      id: 'close-all',
      label: 'Close all tabs',
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(id, 'all') === 0,
      run: () => void workspace.closeAround(id, 'all'),
    },
    keyed('deselect-tab', 'Deselect tab', 'app.deselect-tab', { disabled: !tab }),
    keyed('deselect-all', 'Deselect all tabs', 'app.deselect-all', {
      disabled: !workspace.tabs.some((one) => workspace.panes.at(one.paneId)),
    }),
    {
      id: 'duplicate-tab',
      label: 'Duplicate tab',
      hint: shortcuts.hint('app.duplicate-tab'),
      disabled: !tab || !workspace.canDuplicateTab(tab),
      run: () => void tabOps().then((ops) => ops.duplicateTab(id)),
    },
    {
      id: 'rename',
      label: 'Rename',
      disabled:
        !tab || !workspace.canRenameFromTab(tab) || (tab.path !== null && !canWriteAt(tab.path)),
      run: () => void tabOps().then((ops) => ops.renameFromTab(id)),
    },
    ...(tab && workspace.shownSpaces.length > 1
      ? [
          {
            id: 'move-to-space',
            label: 'Move to space',
            run: () => void tabToSpace().then((one) => one.askSpace([id])),
          },
        ]
      : []),
  ]
}

function paneCommands(): Command[] {
  if (viewport.touch) return []

  return [
    keyed('split-right', 'Split right', 'pane.split-right', {
      disabled: !workspace.canSplit('row'),
    }),
    keyed('split-down', 'Split down', 'pane.split-down', {
      disabled: !workspace.canSplit('column'),
    }),
    keyed('move-tab-pane', 'Move to other pane', 'pane.move-tab', {
      disabled: !workspace.canMoveToOtherPane(workspace.activeTabId ?? ''),
    }),
    keyed('focus-pane', 'Other pane', 'pane.focus-next', { disabled: workspace.panes.count < 2 }),
    {
      id: 'stack-tabs',
      label: workspace.stacked() ? 'Unstack tabs' : 'Stack tabs',
      checked: workspace.stacked(),
      disabled: !workspace.canStack(),
      run: () => workspace.toggleStacked(),
    },
    {
      id: 'close-pane',
      label: 'Close this pane',
      disabled: workspace.panes.count < 2,
      run: () => void workspace.closePane(),
    },
  ]
}

function layoutCommands(): Command[] {
  if (viewport.touch) return []

  const saved = workspace.layouts.all

  return [
    { id: 'save-layout', label: 'Save layout', run: () => void askForLayoutName() },
    ...saved.map((one) => ({
      id: `layout:${one.name}`,
      label: `Layout: ${one.name}`,
      run: () => void workspace.useLayout(one.name),
    })),
    {
      id: 'delete-layout',
      label: 'Delete a layout',
      disabled: !saved.length,
      run: () => void askWhichLayoutToDelete(),
    },
  ]
}

async function askForLayoutName() {
  const name = await prompt.ask({
    title: 'Name this layout',
    placeholder: 'Reading',
    confirmLabel: 'Save',
  })

  if (name) workspace.saveLayout(name)
}

async function askWhichLayoutToDelete() {
  const chosen = await prompt.find({
    title: 'Delete a layout',
    options: workspace.layouts.all.map((one) => ({ id: one.name, label: one.name })),
  })

  if (chosen) workspace.layouts.remove(chosen)
}

function lineCommands(view?: EditorView): Command[] {
  const row = (
    id: string,
    label: string,
    command: (view: EditorView) => boolean,
    writes = true,
  ): Command => ({
    id,
    label,
    hint: shortcuts.hint(id),
    disabled: !view || (writes && view.state.readOnly),
    run: () => {
      if (!view) return
      command(view)
      view.focus()
    },
  })

  return [
    row('view.fold', 'Fold', toggleFold, false),
    row('view.fold-all', 'Fold everything', foldHeadings, false),
    row('view.fold-more', 'Fold more', foldMore, false),
    row('view.fold-less', 'Fold less', foldLess, false),
    row('view.unfold-all', 'Unfold everything', unfoldEverything, false),
    row('edit.expand-selection', 'Expand the selection', expandSelection, false),
    row('edit.shrink-selection', 'Shrink the selection', shrinkSelection, false),
    row('edit.select-word', 'Select the word, then the next', selectWord, false),
    row('edit.insert-line-above', 'Insert a line above', insertLineAbove),
    row('edit.delete-line', 'Delete the line', deleteLine),
    row('edit.join-lines', 'Join the lines', joinLines),
    row('edit.sort-lines', 'Sort the lines', sortLines),
    row('edit.reverse-lines', 'Reverse the lines', reverseLines),
    row('edit.upper-case', 'Upper case', upperCase),
    row('edit.lower-case', 'Lower case', lowerCase),
    row('edit.title-case', 'Title case', titleCase),
    row('edit.duplicate-block', 'Duplicate the block', duplicateBlock),
    row('edit.move-block-up', 'Move the block up', moveBlockUp),
    row('edit.move-block-down', 'Move the block down', moveBlockDown),
    row('edit.undo', 'Undo', undoEdit),
    row('edit.redo', 'Redo', redoEdit),
    row('format.inline-math', 'Inline math', toggleWrap('$')),
    row('format.superscript', 'Superscript', toggleWrap('^')),
    row('format.subscript', 'Subscript', toggleWrap('~')),
    row('edit.paste-plain', 'Paste as plain text', pastePlain),
    row('edit.find-next', 'Find next', findNext, false),
    row('edit.find-previous', 'Find previous', findPrevious, false),
  ]
}

interface Block {
  id: string
  label: () => string
  apply: (view?: EditorView) => void
  ready?: (view: EditorView | undefined) => boolean
  byHand?: boolean
}

function on(command: StateCommand) {
  return (view?: EditorView) => {
    if (!view) return

    command({ state: view.state, dispatch: (one: Transaction) => view.dispatch(one) })
    view.focus()
  }
}

function block(id: string, label: () => string, command: StateCommand): Block {
  return { id, label, apply: on(command) }
}

const WRITTEN: Block[] = [
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    block(`paragraph.heading-${level}`, () => `Heading ${level}`, setHeading(level)),
  ),
  block('paragraph.body', () => 'Paragraph', setHeading(0)),
  block('paragraph.heading-up', () => 'One heading level up', shiftHeading(1)),
  block('paragraph.heading-down', () => 'One heading level down', shiftHeading(-1)),
  {
    id: 'paragraph.table',
    label: () => 'Table',
    apply: (view) => {
      if (view) insertTableToEdit(view)
    },
  },
  block('paragraph.code-block', () => 'Code block', insertCodeFence),
  block('paragraph.quote', () => 'Quote', toggleQuote),
  block('paragraph.math-block', () => 'Math block', insertMathBlock),
  block('paragraph.chart', () => 'Chart', insertChart),
  block('ai-block', () => 'AI block', insertAiBlock),
  block('paragraph.callout', () => 'Callout', insertCallout),
  block('paragraph.bullet-list', () => 'Bulleted list', toggleBulletList),
  block('paragraph.ordered-list', () => 'Numbered list', toggleOrderedList),
  block('paragraph.task-list', () => 'Task list', toggleTaskList),
  {
    id: 'picture',
    label: () => 'Picture',
    apply: (view) => {
      if (view) void insertPicture(view)
    },
    ready: (view) => canInsertPicture(view),
  },
  {
    id: 'photo',
    label: () => 'Photo',
    apply: (view) => {
      if (view) void takePhoto(view)
    },
    ready: (view) => canTakePhoto(view),
    byHand: true,
  },
]

const LINKED: Block[] = [
  block('format.link', () => 'Link', insertLink),
  block('paragraph.footnote', () => 'Footnote', insertFootnote),
  block('paragraph.toc', () => 'Table of contents', insertToc),
  block('format.comment', () => 'Comment', insertComment),
  block('paragraph.rule', () => 'Horizontal rule', insertHorizontalRule),
  block('page-break', () => 'Page break', insertPageBreak),
]

function recorded(view?: EditorView): Block[] {
  return commandRows('record', view).map((row) => ({
    id: row.id,
    label: () => row.label,
    apply: (target) => {
      const ran =
        target === view ? row : commandRows('record', target).find((one) => one.id === row.id)
      ran?.run()
    },
    ready: () => row.disabled !== true,
    byHand: row.byHand === true,
  }))
}

function blocks(view?: EditorView): Block[] {
  return [...WRITTEN, ...recorded(view), ...LINKED]
}

export function blockCommands(view?: EditorView): Command[] {
  return blocks(view).map((one) => {
    const hint = shortcuts.hint(one.id)
    const ready = one.ready ? one.ready(view) : !!view && !view.state.readOnly

    return {
      id: one.id,
      label: one.label(),
      ...(hint === undefined ? {} : { hint }),
      ...(one.byHand === true ? { byHand: true } : {}),
      disabled: !ready,
      run: () => one.apply(view),
    }
  })
}

export function blockRows(): SlashBlock[] {
  return blocks().map((one) => ({ label: one.label(), run: one.apply }))
}

function moveCommand(): Command | null {
  const note = workspace.active
  const path = note?.path
  if (!path || !canWriteAt(path)) return null

  const targets = moveTargets({
    moving: path,
    tree: workspace.tree,
    spaces: workspace.shownSpaces,
    here: workspace.activeSpace?.root ?? null,
  }).filter((target) => canWriteAt(target.id))
  if (!targets.length) return null

  const moved = async (into: string) => {
    const space = workspace.spaces.find((one) => samePath(one.root, into))
    if (space && space.id !== workspace.activeSpaceId) {
      return tabToSpace().then((one) => one.toSpace([note.id], space.id))
    }
    await workspace.moveMany([path], into)
  }

  return {
    id: 'move-note',
    label: 'Move this note',
    run: () =>
      void prompt
        .find({ title: 'Move to', options: [...targets] })
        .then((into) => (into ? moved(into) : undefined)),
  }
}

function spaceCommands(): Command[] {
  const space = workspace.activeSpace
  if (!space) return []

  const moving = moveCommand()

  return [
    ...(moving ? [moving] : []),
    ...(workspace.shownSpaces.length > 1
      ? workspace.shownSpaces.map((one) => ({
          id: `space:${one.id}`,
          label: `Space: ${one.name}`,
          checked: one.id === space.id,
          run: () => void workspace.showSpace(one.id),
        }))
      : []),
    ...(canShare(space)
      ? [{ id: 'share', label: 'Share this space', run: () => void shareSpace(space) }]
      : []),
    ...(isDesktop && !__EVEN_PLUGIN__ && internal.routed?.('read_tree', { root: space.root })
      ? [
          {
            id: 'export-space',
            label: 'Export this space as Markdown and folders',
            run: () =>
              busy.start(
                'Exporting',
                async () => {
                  const items = workspace.itemMeta.itemsOf(space.root)
                  const metaOf = (path: string) => items[path] ?? null
                  await exportSpace(space.root, space.name, metaOf)
                },
                'export-space',
              ),
          },
        ]
      : []),
    ...(canShareItem(workspace.active?.path)
      ? [
          {
            id: 'share-note',
            label: 'Share this note',
            run: () => void shareThisFile(workspace.active?.path ?? ''),
          },
        ]
      : []),
    ...(canPublish(space)
      ? [{ id: 'publish', label: 'Publish this space as a blog', run: () => publishSpace(space) }]
      : []),
  ]
}

export function tidies(path: string | null): boolean {
  return path === null || isMarkdownPath(path)
}

const shut = () => protection.locked(workspace.active?.path)

export function appCommands(view?: EditorView): Command[] {
  const unsaved = workspace.active && isUnsaved(workspace.active.note) ? workspace.active : null
  const space = workspace.activeSpace
  const readOnly = space ? !canWriteAt(space.root) : false

  return without([
    ...(unsaved
      ? [{ id: 'save', label: 'Save', hint: shortcuts.saveHint, run: () => askPlace(unsaved.id) }]
      : []),
    { id: 'new', label: 'New note', hint: shortcuts.hint('app.new'), run: entry('app.new') },
    ...(__EVEN_PLUGIN__ ? [] : [keyed('quick-add', 'Add task', 'app.quick-add')]),
    ...commandRows('send', view),
    {
      id: 'new-unique',
      label: 'New unique note',
      disabled: readOnly,
      run: () => void workspace.createUniqueNote(choices.noteIdFormat),
    },
    {
      id: 'new-canvas',
      label: 'New canvas',
      disabled: readOnly,
      run: () => void workspace.createCanvas(),
    },
    {
      id: 'new-pages',
      label: 'New page note',
      disabled: readOnly,
      run: () => void workspace.createPages(),
    },
    ...(basesOn()
      ? [commanded('new-database', 'New database', 'views.new-database', { disabled: readOnly })]
      : []),
    commanded('new-from-template', 'New note from template', 'views.pick-template', {
      disabled: readOnly,
    }),
    ...(viewport.touch
      ? []
      : [
          {
            id: 'new-web-note',
            label: 'New web note',
            disabled: readOnly,
            run: () => void workspace.createWebsite(),
          },
          { id: 'new-website', label: 'Open a website', run: () => workspace.openWebsite() },
        ]),
    ...(!__EVEN_PLUGIN__ && isDesktop && modes.coder
      ? [
          commanded('new-terminal', 'New terminal', 'terminal.new', { ownWindow: true }),
          commanded('new-remote', 'Remote', 'terminal.remote', { ownWindow: true }),
        ]
      : []),
    ...(__EVEN_PLUGIN__ || !modes.coder
      ? []
      : [
          commanded('new-online-terminal', 'New online terminal', 'terminal.online', {
            ownWindow: true,
          }),
          commanded('start-online-machine', 'Start online machine', 'terminal.machine-start', {
            ownWindow: true,
          }),
          commanded('stop-online-machine', 'Stop online machine', 'terminal.machine-stop', {
            ownWindow: true,
          }),
        ]),
    ...(links.websiteNotes
      ? [
          {
            id: 'convert-website-notes',
            label: 'Convert website notes',
            disabled: readOnly,
            run: () => void workspace.convertWebsites(),
          },
        ]
      : []),
    {
      id: 'random-note',
      label: 'Random note',
      hint: shortcuts.hint('app.random-note'),
      disabled: !randomChoices().length,
      run: () => openRandomNote(),
    },
    ...importCommands(),
    commanded('convert-syntax', 'Convert syntax', 'import.convert-syntax', { disabled: readOnly }),
    ...(canPrint
      ? [
          {
            id: 'print',
            label: 'Print',
            hint: shortcuts.hint('app.print'),
            disabled: !printable(workspace.active?.kind) || shut(),
            run: () => void runCommand('export.print'),
          },
        ]
      : []),
    keyed('close', 'Close note', 'app.close'),
    ...archiveCommand(),
    ...protectCommands(),
    ...tabCommands(),
    keyed('back', 'Back', 'app.back', { disabled: !workspace.active?.canGoBack }),
    keyed('forward', 'Forward', 'app.forward', { disabled: !workspace.active?.canGoForward }),
    keyed('reopen', 'Reopen closed tab', 'app.reopen', { disabled: !workspace.closed.any }),
    { id: 'space', label: 'New space', run: () => void newSpace() },
    ...commandRows('web', view),
    ...paneCommands(),
    ...layoutCommands(),
    keyed('new-window', 'New window', 'app.new-window', { disabled: !isDesktop }),
    keyed('close-window', 'Close window', 'app.close-window', { disabled: !isDesktop }),
    keyed('new-private', 'New private tab', 'app.new-private', {
      disabled: !isDesktop || viewport.touch,
    }),
    {
      id: 'web-history',
      label: 'Browsing history',
      hint: shortcuts.hint('web.history'),
      disabled: viewport.touch,
      run: () => void runCommand('web.history'),
    },
    {
      id: 'undo-file',
      label: workspace.undoLabel ?? 'Undo the last file change',
      disabled: !workspace.undoLabel,
      run: () => void workspace.undoFileAction(),
    },
    {
      id: 'redo-file',
      label: 'Redo the last file change',
      disabled: !workspace.canRedo,
      run: () => void workspace.redoFileAction(),
    },
    keyed('settings', 'Settings', 'app.settings'),
    {
      id: 'feedback',
      label: 'Send feedback',
      also: ['feedback', 'bug', 'report'],
      run: showFeedback,
    },
    keyed('shortcuts', 'Shortcuts', 'app.keys', { also: ['keyboard shortcuts', 'keys'] }),
    {
      id: 'history',
      label: 'Version history',
      disabled: !workspace.active?.path || shut(),
      run: () => (settingsWindow().historyOpen = true),
    },
    ...commandRows('agent-undo', view),
    ...agentRows(),
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'copy-uri',
            label: 'Copy link to this note',
            disabled: !workspace.active?.path,
            run: () => void copyNoteLink(),
          },
        ]),

    ...commandRows('export-picker', view),
    ...commandRows('export', view),
    ...spaceCommands(),
    { id: 'llm', label: 'Connect an LLM to your notes', run: () => settingsWindow().show('llm') },

    account.user
      ? {
          id: 'signout',
          label: account.user.email ? `Sign out ${account.user.email}` : 'Sign out',
          byHand: true,
          run: () => void account.leave(),
        }
      : { id: 'signin', label: 'Sign in', run: () => (account.open = true) },

    {
      id: 'reformat',
      label: 'Tidy up this note',
      disabled: !view || view.state.readOnly || !tidies(workspace.active?.path ?? null),
      run: () =>
        view &&
        reformatDocument({
          state: view.state,
          dispatch: (transaction: Transaction) => view.dispatch(transaction),
        }),
    },

    ...blockCommands(view),
    ...lineCommands(view),
    keyed('reading', workspace.active?.reading ? 'Leave reading' : 'Reading', 'app.reading', {
      disabled: workspace.active?.kind !== 'note',
    }),
    keyed('read-only', modes.readOnly ? 'Leave read-only' : 'Read-only', 'app.read-only', {}, view),
    keyed(
      'source',
      modes.sourceIn(view) ? 'Leave source mode' : 'Source mode',
      'app.source',
      {},
      view,
    ),
    keyed('focus', modes.focus ? 'Leave focus mode' : 'Focus mode', 'app.focus', {}, view),
    keyed(
      'typewriter',
      modes.typewriter ? 'Leave typewriter mode' : 'Typewriter mode',
      'app.typewriter',
      {},
      view,
    ),
    ...(viewport.touch
      ? []
      : [
          keyed(
            'full-window',
            workspace.panes.fills === null ? 'Full window' : 'Leave full window',
            'app.fill-tab',
            { disabled: workspace.panes.fills === null && !workspace.activeTabId },
          ),
        ]),
    keyed('fullscreen', fullscreen.on ? 'Leave fullscreen' : 'Fullscreen', 'app.fullscreen'),
    ...(isDesktop
      ? [
          {
            id: 'always-on-top',
            label: 'Always on top',
            checked: modes.alwaysOnTop,
            run: () => modes.toggleAlwaysOnTop(),
          },
        ]
      : []),

    {
      id: 'punctuation',
      label: modes.punctuation ? 'Use straight quotes' : 'Use curly quotes',
      run: () => modes.togglePunctuation(view),
    },
    {
      id: 'numbers',
      label: modes.numbers ? 'Stop numbering headings' : 'Number headings',
      run: () => modes.toggleNumbers(view),
    },

    {
      id: 'line-numbers',
      label: modes.lineNumbers ? 'Hide code line numbers' : 'Show code line numbers',
      run: () => modes.toggleLineNumbers(view),
    },
    {
      id: 'rtl',
      label: modes.rtl ? 'Write left to right' : 'Write right to left',
      run: () => modes.toggleRightToLeft(view),
    },
    {
      id: 'strict',
      label: modes.strict ? 'Allow extended markdown' : 'Strict CommonMark only',
      run: () => modes.toggleStrict(view),
    },
    {
      id: 'equation-numbers',
      label: modes.equationNumbers ? 'Stop numbering equations' : 'Number equations',
      run: () => modes.toggleEquationNumbers(view),
    },
    { id: 'wider', label: 'Wider writing area', run: () => modes.stepWidth(1, view) },
    { id: 'narrower', label: 'Narrower writing area', run: () => modes.stepWidth(-1, view) },
    { id: 'looser', label: 'Looser line spacing', run: () => modes.stepLineHeight(1, view) },
    { id: 'tighter', label: 'Tighter line spacing', run: () => modes.stepLineHeight(-1, view) },

    keyed('zoom-in', 'Zoom in', 'app.zoom-in'),
    keyed('zoom-out', 'Zoom out', 'app.zoom-out'),
    keyed('zoom-reset', 'Actual size', 'app.zoom-reset'),

    ...(isDesktop
      ? [
          {
            id: 'window-frame',
            label: 'Window frame',
            run: () => modes.setFrame(modes.frame === 'system' ? 'orden' : 'system'),
          },
        ]
      : []),

    {
      id: 'themes',
      label: 'Switch theme',
      run: () => void import('../../theme-looks/src/api').then((one) => one.pickTheme()),
    },
    ...theme.all.map((item) => ({
      id: `theme:${item.id}`,
      label: `Theme: ${item.name}`,
      checked: item.id === theme.id,
      run: () => theme.select(item.id),
    })),
    ...commandRows('ai-accounts', view),
    ...SCHEME_CHOICES.map((choice) => ({
      id: `scheme:${choice}`,
      label: `Mode: ${SCHEME_NAMES[choice]}`,
      checked: choice === theme.shown,
      disabled: !theme.offers(choice),
      run: () => theme.setScheme(choice),
    })),
    ...(theme.accentIsTheme
      ? []
      : theme.accents.map((swatch) => ({
          id: `accent:${swatch.id}`,
          label: `Accent: ${swatch.name}`,
          checked: swatch.id === theme.accent,
          run: () => theme.setAccent(swatch.id),
        }))),
    ...CODE_PALETTES.map((palette) => ({
      id: `code-theme:${palette.id}`,
      label: `Code theme: ${paletteName(palette)}`,
      checked: palette.id === modes.codeTheme,
      run: () => modes.setCodeTheme(palette.id, view),
    })),
    ...(isDesktop
      ? [{ id: 'themes-folder', label: 'Open themes folder', run: () => void openThemesFolder() }]
      : []),
    ...(isNative
      ? [
          { id: 'custom-css', label: 'Edit custom CSS', run: () => void openCustomCss() },
          { id: 'snippets', label: 'Edit snippets', run: () => void openSnippets() },
        ]
      : []),
    ...(isDesktop ? [{ id: 'logs', label: 'Open the log file', run: () => void openLog() }] : []),
    {
      id: 'update',
      label: 'Check for updates',
      disabled: !isDesktop,
      run: () => void updates.check(),
    },
    { id: 'whats-new', label: 'What is new', run: () => void openExternal(RELEASES_URL) },
    { id: 'report-issue', label: 'Report an issue', run: () => void openExternal(ISSUES_URL) },
    { id: 'source-code', label: 'Source code', run: () => void openExternal(SOURCE_URL) },
    keyed('sidebar', workspace.panel ? 'Hide left sidebar' : 'Show left sidebar', 'app.sidebar'),
    keyed('files', 'Files', 'app.files'),
    keyed('reveal', 'Show in the file list', 'app.reveal', { disabled: !workspace.active?.path }),
    keyed('fold-list', 'Collapse the file list', 'app.fold-list', {
      disabled: !workspace.unfolded,
    }),
    keyed('outline-panel', 'Outline', 'app.outline'),
    {
      id: 'search-space',
      label: 'Search this space',
      hint: shortcuts.hint('app.search'),
      run: entry('app.search', view),
    },
    keyed('links-panel', 'Links', 'app.links'),
    ...(viewport.touch ? [] : [keyed('ask-panel', 'Ask', 'app.ask')]),
    keyed('quick-question', 'Quick question', 'app.quick-question'),
    keyed('reload-app', 'Reload Orden', 'app.reload'),
    keyed('scratchpad', 'Scratchpad', 'app.scratchpad'),
    keyed(
      'right-sidebar',
      workspace.openOn('right') ? 'Hide right sidebar' : 'Show right sidebar',
      'app.right-sidebar',
      { disabled: !workspace.right.length },
    ),
    {
      id: 'hold-panel',
      label: workspace.held ? 'Follow the open note' : 'Stay on this note',
      checked: workspace.held,
      disabled: workspace.holdablePanel === null,
      run: () => workspace.holdPanel(workspace.held ? null : (workspace.panelTab?.id ?? null)),
    },
    keyed('graph', 'Graph', 'app.graph'),
    ...(__EVEN_PLUGIN__ || !passOn()
      ? []
      : [
          keyed('pass', 'Pass', 'app.pass'),
          commanded('pass-lock', 'Lock Pass', 'pass.lock'),
          commanded('pass-new-login', 'New login', 'pass.new-login'),
          commanded('pass-generate', 'Generate password', 'pass.generate'),
        ]),
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'todos',
            label: 'Todos',
            hint: shortcuts.hint('app.tasks'),
            run: entry('app.tasks'),
          },
          ...(timeOn()
            ? [
                keyed('time-tab', 'Open time tracker', 'time.tab'),
                keyed('time-start', 'Start timer', 'time.start'),
                keyed('time-stop', 'Stop timer', 'time.stop'),
              ]
            : []),
        ]),
    keyed('region-next', 'Next section', 'app.region-next'),
    keyed('region-previous', 'Previous section', 'app.region-previous'),
    keyed('spaces', 'Spaces', 'space.switcher'),
    keyed('tab-overview', 'Tabs', 'app.tab-overview'),
    keyed('space-next', 'Next space', 'space.next', { disabled: workspace.shownSpaces.length < 2 }),
    keyed('space-previous', 'Previous space', 'space.previous', {
      disabled: workspace.shownSpaces.length < 2,
    }),

    ...composerCommands(view),
  ])
}

const MAKES: Record<string, KindName> = {
  new: 'note',
  'new-unique': 'note',
  'new-from-template': 'note',
  'new-canvas': 'canvas',
  'new-pages': 'pages',
  'new-web-note': 'web',
  'new-website': 'web',
  'new-terminal': 'terminal',
  'new-remote': 'remote',
  'new-online-terminal': 'online',
  'new-private': 'private',
}

function without(rows: Command[]): Command[] {
  return rows.filter((row) => {
    const kind = MAKES[row.id]
    return !kind || !turnedOff(kind)
  })
}

export async function runRow(id: string): Promise<boolean> {
  await commandRowsLoaded()
  const row = appCommands().find((one) => one.id === id)
  if (!row || row.disabled === true) return false
  row.run()
  return true
}
