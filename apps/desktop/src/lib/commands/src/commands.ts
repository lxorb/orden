import { protection } from '../../protect/src/api'
import { commandRows, commandRowsLoaded, runCommand } from '@orden/contracts'
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
import { busy, prompt, viewport } from '../../ui-kit/src/api'
import { turnedOff } from '../../kind-choice'
import { composerCommands } from '../../composer-commands'
import { paletteName } from '../../highlight/src/api'
import { links } from '../../link-index/src/api'
import type { MenuItem } from '../../ui-kit/src/api'
import { canPrint, printable } from '../../export-formats/src/api'
import { printOpen } from '../../open-out'
import { canInsertPicture, canTakePhoto, insertPicture, takePhoto } from './insert-picture'
import { moveTargets } from '../../move-targets'
import { closeAfterLabel } from '../../panes/src/api'
import { revealPanel, stepRegionFocus } from '../../focus'
import { newSpace, publishSpace, shareSpace, stepSpace } from '../../space-actions'
import { spacePicker } from '../../space-picker.svelte'
import {
  canPublish,
  canShare,
  canShareItem,
  canWriteAt,
  shareThisFile,
  lockAllEntry,
  protectEntries,
} from '../../sharing/src/api'
import { archiveEntry, DIVIDER } from '../../menu.svelte'
import { updates } from '../../updates/src/api'
import { modes } from '../../modes.svelte'
import { basesOn, type KindName, passOn, settings, timeOn } from '../../settings.svelte'
import { agentMarks } from '../../agent-marks.svelte'
import { shortcuts } from '../../shortcuts/src/api'
import { toggleFill } from '../../tab-fill/src/api'
import { fullscreen } from '../../fullscreen.svelte'
import { ISSUES_URL, RELEASES_URL, SOURCE_URL } from '../../links'
import {
  closeWindow,
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
import { workspace } from '../../workspace/src/api'
import { isUnsaved } from '../../documents/src/api'
import { askPlace } from '../../save-place/src/api'
import { tabOps, tabToSpace } from '../../tab-strip/src/api'
import { openRandomNote, randomChoices } from './random-note'
import { showFeedback, showQuickAdd, toggleTabOverview } from '../../surfaces.svelte'

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

function importCommands(): Command[] {
  if (__EVEN_PLUGIN__) return []

  const asked = (id: string) => () => {
    settings.show('import')
    void runCommand(id)
  }

  return [
    { id: 'import', label: 'Import', run: () => void runCommand('import.show') },
    { id: 'import-obsidian', label: 'Import from Obsidian', run: asked('import.obsidian') },
    {
      id: 'import-notion',
      label: 'Import from Notion',
      run: () => void runCommand('import.notion'),
    },
    ...(isDesktop
      ? [{ id: 'import-zen', label: 'Import from Zen', run: asked('import.zen') }]
      : []),
  ]
}

async function openLog() {
  if (!isDesktop) return

  const path = await invoke<string>('log_dir')
  const { reveal } = await import('../../reveal')
  await reveal(path)
}

async function openThemesFolder() {
  if (!isDesktop) return

  const dir = await invoke<string>('theme_dir')
  const { reveal } = await import('../../reveal')
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
    {
      id: 'agents-stop',
      label: 'Stop agents',
      hint: shortcuts.hint('agents.stop'),
      ownWindow: true,
      run: () => void runCommand('agents.stop'),
    },
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
    {
      id: 'deselect-tab',
      label: 'Deselect tab',
      hint: shortcuts.hint('app.deselect-tab'),
      disabled: !tab,
      run: () => workspace.deselect(),
    },
    {
      id: 'deselect-all',
      label: 'Deselect all tabs',
      hint: shortcuts.hint('app.deselect-all'),
      disabled: !workspace.tabs.some((one) => workspace.panes.at(one.paneId)),
      run: () => workspace.deselectAll(),
    },
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
    {
      id: 'split-right',
      label: 'Split right',
      hint: shortcuts.hint('pane.split-right'),
      disabled: !workspace.canSplit('row'),
      run: () => workspace.split('row'),
    },
    {
      id: 'split-down',
      label: 'Split down',
      hint: shortcuts.hint('pane.split-down'),
      disabled: !workspace.canSplit('column'),
      run: () => workspace.split('column'),
    },
    {
      id: 'move-tab-pane',
      label: 'Move to other pane',
      hint: shortcuts.hint('pane.move-tab'),
      disabled: !workspace.canMoveToOtherPane(workspace.activeTabId ?? ''),
      run: () => void tabOps().then((ops) => ops.moveToOtherPane(workspace.activeTabId ?? '')),
    },
    {
      id: 'focus-pane',
      label: 'Other pane',
      hint: shortcuts.hint('pane.focus-next'),
      disabled: workspace.panes.count < 2,
      run: () => workspace.panes.focusNext(),
    },
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
    {
      id: 'save-layout',
      label: 'Save layout',
      run: () => void askForLayoutName(),
    },
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

function foldingCommands(view?: EditorView): Command[] {
  const fold = (id: string, label: string, command: StateCommand): Command => ({
    id,
    label,
    hint: shortcuts.hint(id),
    disabled: !view,
    run: () => {
      if (!view) return
      command(view)
      view.focus()
    },
  })

  return [
    fold('view.fold', 'Fold', toggleFold),
    fold('view.fold-all', 'Fold everything', foldHeadings),
    fold('view.fold-more', 'Fold more', foldMore),
    fold('view.fold-less', 'Fold less', foldLess),
    fold('view.unfold-all', 'Unfold everything', unfoldEverything),
  ]
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
    apply: () => row.run(),
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
    { id: 'new-space', label: 'New space', run: () => void newSpace() },
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
      ? [
          {
            id: 'publish',
            label: 'Publish this space as a blog',
            run: () => publishSpace(space),
          },
        ]
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
      ? [
          {
            id: 'save',
            label: 'Save',
            hint: shortcuts.saveHint,
            run: () => askPlace(unsaved.id),
          },
        ]
      : []),
    {
      id: 'new',
      label: 'New note',
      hint: shortcuts.hint('app.new'),
      run: () => workspace.openBlank(),
    },
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'quick-add',
            label: 'Add task',
            hint: shortcuts.hint('app.quick-add'),
            run: () => showQuickAdd(),
          },
        ]),
    ...commandRows('send', view),
    {
      id: 'new-unique',
      label: 'New unique note',
      disabled: readOnly,
      run: () => void workspace.createUniqueNote(settings.noteIdFormat),
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
      ? [
          {
            id: 'new-database',
            label: 'New database',
            disabled: readOnly,
            run: () => void runCommand('views.new-database'),
          },
        ]
      : []),
    {
      id: 'new-from-template',
      label: 'New note from template',
      disabled: readOnly,
      run: () => void runCommand('views.pick-template'),
    },
    ...(viewport.touch
      ? []
      : [
          {
            id: 'new-web-note',
            label: 'New web note',
            disabled: readOnly,
            run: () => void workspace.createWebsite(),
          },
          {
            id: 'new-website',
            label: 'Open a website',
            run: () => workspace.openWebsite(),
          },
        ]),
    ...(!__EVEN_PLUGIN__ && isDesktop && modes.coder
      ? [
          {
            id: 'new-terminal',
            label: 'New terminal',
            ownWindow: true,
            run: () => void runCommand('terminal.new'),
          },
          {
            id: 'new-remote',
            label: 'Remote',
            ownWindow: true,
            run: () => void runCommand('terminal.remote'),
          },
        ]
      : []),
    ...(__EVEN_PLUGIN__ || !modes.coder
      ? []
      : [
          {
            id: 'new-online-terminal',
            label: 'New online terminal',
            ownWindow: true,
            run: () => void runCommand('terminal.online'),
          },
          {
            id: 'start-online-machine',
            label: 'Start online machine',
            ownWindow: true,
            run: () => void runCommand('terminal.machine-start'),
          },
          {
            id: 'stop-online-machine',
            label: 'Stop online machine',
            ownWindow: true,
            run: () => void runCommand('terminal.machine-stop'),
          },
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
    {
      id: 'convert-syntax',
      label: 'Convert syntax',
      disabled: readOnly,
      run: () => void runCommand('import.convert-syntax'),
    },
    ...(canPrint
      ? [
          {
            id: 'print',
            label: 'Print',
            hint: shortcuts.hint('app.print'),
            disabled: !printable(workspace.active?.kind) || shut(),
            run: () => busy.start('Printing', () => printOpen(), 'print'),
          },
        ]
      : []),
    {
      id: 'close',
      label: 'Close note',
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeActive(),
    },
    ...archiveCommand(),
    ...protectCommands(),
    ...tabCommands(),
    {
      id: 'back',
      label: 'Back',
      hint: shortcuts.hint('app.back'),
      disabled: !workspace.active?.canGoBack,
      run: () => workspace.goBack(),
    },
    {
      id: 'forward',
      label: 'Forward',
      hint: shortcuts.hint('app.forward'),
      disabled: !workspace.active?.canGoForward,
      run: () => workspace.goForward(),
    },
    {
      id: 'reopen',
      label: 'Reopen closed tab',
      hint: shortcuts.hint('app.reopen'),
      disabled: !workspace.closed.any,
      run: () => void workspace.reopenClosed(),
    },
    { id: 'space', label: 'New space', run: () => void newSpace() },
    ...commandRows('web', view),
    ...paneCommands(),
    ...layoutCommands(),
    {
      id: 'new-window',
      label: 'New window',
      hint: shortcuts.hint('app.new-window'),
      disabled: !isDesktop,
      run: () => void invoke('new_window').catch(() => undefined),
    },
    {
      id: 'close-window',
      label: 'Close window',
      hint: shortcuts.hint('app.close-window'),
      disabled: !isDesktop,
      run: () => void closeWindow(),
    },
    {
      id: 'new-private',
      label: 'New private tab',
      hint: shortcuts.hint('app.new-private'),
      disabled: !isDesktop || viewport.touch,
      run: () => void runCommand('app.new-private'),
    },
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
    {
      id: 'settings',
      label: 'Settings',
      hint: shortcuts.hint('app.settings'),
      run: () => settings.show(),
    },
    {
      id: 'feedback',
      label: 'Send feedback',
      also: ['feedback', 'bug', 'report'],
      run: showFeedback,
    },
    {
      id: 'shortcuts',
      label: 'Shortcuts',
      hint: shortcuts.hint('app.keys'),
      run: () => settings.show('shortcuts'),
    },
    {
      id: 'history',
      label: 'Version history',
      disabled: !workspace.active?.path || shut(),
      run: () => (settings.historyOpen = true),
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
    { id: 'llm', label: 'Connect an LLM to your notes', run: () => settings.show('llm') },

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
    ...foldingCommands(view),
    ...lineCommands(view),
    {
      id: 'reading',
      label: workspace.active?.reading ? 'Leave reading' : 'Reading',
      hint: shortcuts.hint('app.reading'),
      disabled: workspace.active?.kind !== 'note',
      run: () => workspace.toggleReading(),
    },
    {
      id: 'read-only',
      label: modes.readOnly ? 'Leave read-only' : 'Read-only',
      hint: shortcuts.hint('app.read-only'),
      run: () => modes.toggleReadOnly(view),
    },
    {
      id: 'source',
      label: modes.sourceIn(view) ? 'Leave source mode' : 'Source mode',
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
    {
      id: 'focus',
      label: modes.focus ? 'Leave focus mode' : 'Focus mode',
      hint: shortcuts.hint('app.focus'),
      run: () => modes.toggleFocus(view),
    },
    {
      id: 'typewriter',
      label: modes.typewriter ? 'Leave typewriter mode' : 'Typewriter mode',
      hint: shortcuts.hint('app.typewriter'),
      run: () => modes.toggleTypewriter(view),
    },
    ...(viewport.touch
      ? []
      : [
          {
            id: 'full-window',
            label: workspace.panes.fills === null ? 'Full window' : 'Leave full window',
            hint: shortcuts.hint('app.fill-tab'),
            disabled: workspace.panes.fills === null && !workspace.activeTabId,
            run: () => void toggleFill(),
          },
        ]),
    {
      id: 'fullscreen',
      label: fullscreen.on ? 'Leave fullscreen' : 'Fullscreen',
      hint: shortcuts.hint('app.fullscreen'),
      run: () => void fullscreen.toggle(workspace.panes),
    },
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

    {
      id: 'zoom-in',
      label: 'Zoom in',
      hint: shortcuts.hint('app.zoom-in'),
      run: () => workspace.zoomPage('in') || modes.stepZoom(1),
    },
    {
      id: 'zoom-out',
      label: 'Zoom out',
      hint: shortcuts.hint('app.zoom-out'),
      run: () => workspace.zoomPage('out') || modes.stepZoom(-1),
    },
    {
      id: 'zoom-reset',
      label: 'Actual size',
      hint: shortcuts.hint('app.zoom-reset'),
      run: () => workspace.zoomPage('reset') || modes.resetZoom(),
    },

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
      ? [
          {
            id: 'themes-folder',
            label: 'Open themes folder',
            run: () => void openThemesFolder(),
          },
        ]
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
    {
      id: 'sidebar',
      label: workspace.panel ? 'Hide left sidebar' : 'Show left sidebar',
      hint: shortcuts.hint('app.sidebar'),
      run: () => workspace.toggleSidebar(),
    },
    {
      id: 'files',
      label: 'Files',
      hint: shortcuts.hint('app.files'),
      run: () => revealPanel('tree'),
    },
    {
      id: 'reveal',
      label: 'Show in the file list',
      hint: shortcuts.hint('app.reveal'),
      disabled: !workspace.active?.path,
      run: () => workspace.revealNote(),
    },
    {
      id: 'fold-list',
      label: 'Collapse the file list',
      hint: shortcuts.hint('app.fold-list'),
      disabled: !workspace.unfolded,
      run: () => workspace.foldList(),
    },
    {
      id: 'outline-panel',
      label: 'Outline',
      hint: shortcuts.hint('app.outline'),
      run: () => revealPanel('outline'),
    },
    {
      id: 'search-space',
      label: 'Search this space',
      hint: shortcuts.hint('app.search'),
      run: () => revealPanel('search'),
    },
    {
      id: 'links-panel',
      label: 'Links',
      hint: shortcuts.hint('app.links'),
      run: () => revealPanel('links'),
    },
    ...(viewport.touch
      ? []
      : [
          {
            id: 'ask-panel',
            label: 'Ask',
            hint: shortcuts.hint('app.ask'),
            run: () => revealPanel('ask'),
          },
        ]),
    {
      id: 'quick-question',
      label: 'Quick question',
      hint: shortcuts.hint('app.quick-question'),
      run: () => void runCommand('app.quick-question'),
    },
    {
      id: 'reload-app',
      label: 'Reload Orden',
      hint: shortcuts.hint('app.reload'),
      run: () => location.reload(),
    },
    {
      id: 'scratchpad',
      label: 'Scratchpad',
      hint: shortcuts.hint('app.scratchpad'),
      run: () => void runCommand('app.scratchpad'),
    },
    {
      id: 'right-sidebar',
      label: workspace.openOn('right') ? 'Hide right sidebar' : 'Show right sidebar',
      hint: shortcuts.hint('app.right-sidebar'),
      disabled: !workspace.right.length,
      run: () => workspace.toggleSidebar('right'),
    },
    {
      id: 'hold-panel',
      label: workspace.held ? 'Follow the open note' : 'Stay on this note',
      checked: workspace.held,
      disabled: workspace.holdablePanel === null,
      run: () => workspace.holdPanel(workspace.held ? null : (workspace.panelTab?.id ?? null)),
    },
    {
      id: 'graph',
      label: 'Graph',
      hint: shortcuts.hint('app.graph'),
      run: () => workspace.openGraph(),
    },
    ...(__EVEN_PLUGIN__ || !passOn()
      ? []
      : [
          {
            id: 'pass',
            label: 'Pass',
            hint: shortcuts.hint('app.pass'),
            run: () => void runCommand('pass.open'),
          },
          {
            id: 'pass-lock',
            label: 'Lock Pass',
            run: () => void runCommand('pass.lock'),
          },
          {
            id: 'pass-new-login',
            label: 'New login',
            run: () => void runCommand('pass.new-login'),
          },
          {
            id: 'pass-generate',
            label: 'Generate password',
            run: () => void runCommand('pass.generate'),
          },
        ]),
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'todos',
            label: 'Todos',
            hint: shortcuts.hint('app.tasks'),
            run: () => void runCommand('views.todos'),
          },
          ...(timeOn()
            ? [
                {
                  id: 'time-tab',
                  label: 'Open time tracker',
                  hint: shortcuts.hint('time.tab'),
                  run: () => void runCommand('time.tab'),
                },
                {
                  id: 'time-start',
                  label: 'Start timer',
                  hint: shortcuts.hint('time.start'),
                  run: () => void runCommand('time.start'),
                },
                {
                  id: 'time-stop',
                  label: 'Stop timer',
                  hint: shortcuts.hint('time.stop'),
                  run: () => void runCommand('time.stop'),
                },
              ]
            : []),
        ]),
    {
      id: 'region-next',
      label: 'Next section',
      hint: shortcuts.hint('app.region-next'),
      run: () => void stepRegionFocus(1),
    },
    {
      id: 'region-previous',
      label: 'Previous section',
      hint: shortcuts.hint('app.region-previous'),
      run: () => void stepRegionFocus(-1),
    },
    {
      id: 'spaces',
      label: 'Spaces',
      hint: shortcuts.hint('space.switcher'),
      run: () => spacePicker.toggle(),
    },
    {
      id: 'tab-overview',
      label: 'Tabs',
      hint: shortcuts.hint('app.tab-overview'),
      run: toggleTabOverview,
    },
    {
      id: 'space-next',
      label: 'Next space',
      hint: shortcuts.hint('space.next'),
      disabled: workspace.shownSpaces.length < 2,
      run: () => stepSpace(1),
    },
    {
      id: 'space-previous',
      label: 'Previous space',
      hint: shortcuts.hint('space.previous'),
      disabled: workspace.shownSpaces.length < 2,
      run: () => stepSpace(-1),
    },
    {
      id: 'keys',
      label: 'Keyboard shortcuts',
      hint: shortcuts.hint('app.keys'),
      run: () => settings.show('shortcuts'),
    },

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
