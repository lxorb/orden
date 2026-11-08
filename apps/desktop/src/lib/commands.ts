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
  insertSlideBreak,
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
import { deckOf, slideAt } from '@orden/markdown/slides'
import { present } from './slides/present.svelte'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { turnedOff } from './kind-choice'
import { composerCommands } from './composer-commands'
import { key, t } from './i18n.svelte'
import { links } from './link-index.svelte'
import type { MenuItem } from './menu-item'
import type { Exportable } from './export/formats'
import { frontShut, look, openTarget, renderOptions } from './export/context'
import { type ExportId, exportKindOf, isNoteFormat, labelOf, offeredBy } from './export/offer'
import type { RunOptions } from './export/run'
import { PANDOC_FORMATS } from './export-formats'
import { canPrint, printable, printOpen } from './export/print'
import { imagePath } from './images'
import { canDictate, dictating, toggleDictation } from './mobile/dictation'
import { canInsertPicture, canTakePhoto, insertPicture, takePhoto } from './insert-picture'
import { canRecord, record, recordLabel } from './recorder/commands'
import { moveTargets } from './move-targets'
import { closeAfterLabel } from './workspace/closing-around'
import { prompt } from './prompt.svelte'
import { revealPanel, stepRegionFocus } from './focus'
import { newSpace, publishSpace, shareSpace, stepSpace } from './space-actions'
import { spacePicker } from './space-picker.svelte'
import { askQuickly } from './ai/quick-door'
import { switchableAccounts, switchAccount } from './ai/switching'
import { toggleScratchpad } from './scratchpad/is.svelte'
import { canPublish, canShare, canShareItem, canWriteAt, shareThisFile } from './sharing.svelte'
import { archiveEntry, DIVIDER, listEntry } from './menu.svelte'
import { lockAllEntry, protectEntries } from './protect/entries'
import { updates } from './updates.svelte'
import { modes } from './modes.svelte'
import { basesOn, chatsOn, type KindName, passOn, settings, timeOn } from './settings.svelte'
import { touchedBy } from './agents/docs/touched'
import { agentMarks } from './agent-marks.svelte'
import { shortcuts } from './shortcuts.svelte'
import { toggleFill } from './tab-fill/fill'
import { fullscreen } from './fullscreen.svelte'
import { ISSUES_URL, RELEASES_URL, SOURCE_URL } from './links'
import { closeWindow, internal, invoke, isDesktop, isNative, openExternal } from './tauri'
import { SCHEME_CHOICES, SCHEME_NAMES } from './schemes'
import { theme } from './theme.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'
import { isMarkdownPath, samePath } from './space-paths'
import { isUnsaved } from './workspace/drafts'
import { askPlace } from './save-place/door'
import { pages, type Step } from './web-tab/pages.svelte'
import { openRandomNote, randomChoices } from './random-note'
import { showFeedback, showQuickAdd, toggleTabOverview } from './surfaces.svelte'

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

export function exportCommands(): Command[] {
  if (__EVEN_PLUGIN__) return []

  const note = () => workspace.active
  const source = () => openTarget().source
  const name = () => note()?.name ?? 'Untitled.md'
  const target = openTarget
  const shut = (rows: Command[]) =>
    frontShut() ? rows.map((one) => ({ ...one, disabled: true })) : rows

  const open = note()
  const kind = exportKindOf(
    open ? { kind: open.kind, path: open.path, text: open.note.latest } : null,
  )

  const options = (): Promise<RunOptions> => renderOptions(target())

  const noteOut = async (id: Exportable) => {
    const m = await import('./export/run')
    await m.runExport(id, target(), await options())
  }

  const slidesOut = async (id: 'slides-html' | 'slides-pdf') => {
    const m = await import('./slides/file')
    const deck = { text: source(), path: note()?.path ?? null, trusted: target().trusted }
    const options = {
      resolveImage: (src: string) => imagePath(src, note()?.path, source()) ?? src,
      ...(await look()),
    }

    if (id === 'slides-html') await m.exportDeck(deck, name(), options)
    else await m.exportDeckPdf(deck, name(), options)
  }

  const drawingOut = async (id: ExportId) => {
    const [picture, { drawingOf }] = await Promise.all([
      import('./canvas/picture'),
      import('./export/drawing'),
    ])

    const drawing = drawingOf({
      text: source(),
      name: name(),
      path: note()?.path ?? null,
      root: workspace.rootHolding(note()?.path ?? null),
      trusted: target().trusted,
    })

    if (id === 'png') await picture.exportCanvasPng(drawing)
    else if (id === 'svg') await picture.exportCanvasSvg(drawing)
    else if (id === 'pdf') await picture.exportCanvasPdf(drawing)
  }

  const pagesOut = async (id: ExportId) => {
    const out = await import('./pages/out')
    const about = out.pagesOutOf({
      text: source(),
      name: name(),
      path: note()?.path ?? null,
      root: workspace.rootHolding(note()?.path ?? null),
      shared: note()?.note.shared ?? null,
      trusted: target().trusted,
    })

    if (id === 'pdf') await out.exportPagesPdf(about)
    else if (id === 'png') await out.exportPagesPng(about)
    else if (id === 'svg') await out.exportPagesSvg(about)
  }

  const copyOut = async () => {
    const path = target().path
    if (path === null) return

    const m = await import('./export/copy')
    await m.saveCopy(path, name())
  }

  const run = (id: ExportId) => () =>
    busy.start(
      t('Exporting'),
      async () => {
        if (kind === 'canvas') await drawingOut(id)
        else if (kind === 'pages') await pagesOut(id)
        else if (id === 'slides-html' || id === 'slides-pdf') await slidesOut(id)
        else if (id === 'copy') await copyOut()
        else if (isNoteFormat(id)) await noteOut(id)
      },
      `export-${id}`,
    )

  const offered = offeredBy(kind)
  const nothing = offered.length === 0
  const asNote = kind === 'note' || kind === 'deck' || nothing

  const commands: Command[] = (nothing ? offeredBy('note') : offered).map((id) => ({
    id: `export-${id}`,
    label: labelOf(id),
    hint: shortcuts.hint(`export.${id}`),
    disabled: nothing,
    run: run(id),
  }))

  if (asNote) {
    commands.push({
      id: 'page-setup',
      label: t('Page setup for export'),
      run: () => settings.show('export'),
    })
  }

  if (!settings.pandoc) return shut(commands)

  if (!asNote) return shut(commands)

  for (const format of PANDOC_FORMATS) {
    commands.push({
      id: `export-${format.id}`,
      label: t('Export as {format}', { format: t(format.label) }),
      disabled: nothing,
      run: () =>
        busy.start(
          t('Exporting'),
          async () => {
            const m = await import('./export')
            await m.exportPandoc(source(), name(), format.id, note()?.path ?? null)
          },
          `export-${format.id}`,
        ),
    })
  }

  return shut(commands)
}

function importCommand(): Command | null {
  if (__EVEN_PLUGIN__) return null

  return {
    id: 'import',
    label: t('Import'),
    run: () => {
      void import('./importing.svelte').then(({ importing }) => importing.show())
    },
  }
}

function migrateCommands(): Command[] {
  if (__EVEN_PLUGIN__) return []

  return [
    {
      id: 'import-obsidian',
      label: t('Import from Obsidian'),
      run: () => {
        settings.show('import')
        void import('./migrating.svelte').then(({ migrating }) => migrating.obsidian())
      },
    },
    {
      id: 'import-notion',
      label: t('Import from Notion'),
      run: () => {
        void import('./migrating.svelte').then(({ migrating }) => migrating.files())
      },
    },
    ...(isDesktop
      ? [
          {
            id: 'import-zen',
            label: t('Import from Zen'),
            run: () => {
              settings.show('import')
              void import('./migrating.svelte').then(({ migrating }) => migrating.zen())
            },
          },
        ]
      : []),
  ]
}

async function openLog() {
  if (!isDesktop) return

  const path = await invoke<string>('log_dir')
  const { reveal } = await import('./reveal')
  await reveal(path)
}

async function openThemesFolder() {
  if (!isDesktop) return

  const dir = await invoke<string>('theme_dir')
  const { reveal } = await import('./reveal')
  await reveal(dir)
  await theme.reload()
}

export interface Command extends MenuItem {
  id: string
  also?: readonly string[]
  byHand?: boolean
  ownWindow?: boolean
}

const toSpace = () => import('./tab-strip/to-space')

const tabOps = () => import('./tab-strip/ops')

function agentUndoRows(): Command[] {
  const path = workspace.active?.path
  if (__EVEN_PLUGIN__ || !path) return []

  return touchedBy(path).map((agent) => ({
    id: `agent-undo:${agent.id}`,
    label: t('Undo edits by {name}', { name: agent.name }),
    run: () => void import('./agents/docs').then((docs) => docs.undoAgentIn(agent, path)),
  }))
}

function agentRows(): Command[] {
  if (__EVEN_PLUGIN__ || !agentMarks.heard) return []

  return [
    {
      id: 'agents',
      label: t('Agents'),
      run: () => {
        revealPanel('ask')
        void import('./ai/sidebar/chat.svelte').then(({ chat }) => chat.showThreads())
      },
    },
    {
      id: 'agents-stop',
      label: t('Stop agents'),
      hint: shortcuts.hint('agents.stop'),
      ownWindow: true,
      run: () => void import('./agents/ui/index').then((ui) => ui.stopAgents()),
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

function listCommand(): Command[] {
  return listEntry(workspace.active?.path).flatMap((entry) =>
    entry === DIVIDER ? [] : [{ id: 'todo-list', label: entry.label, run: entry.run }],
  )
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
      label: t('Close all tabs'),
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(id, 'all') === 0,
      run: () => void workspace.closeAround(id, 'all'),
    },
    {
      id: 'deselect-tab',
      label: t('Deselect tab'),
      hint: shortcuts.hint('app.deselect-tab'),
      disabled: !tab,
      run: () => workspace.deselect(),
    },
    {
      id: 'deselect-all',
      label: t('Deselect all tabs'),
      hint: shortcuts.hint('app.deselect-all'),
      disabled: !workspace.tabs.some((one) => workspace.panes.at(one.paneId)),
      run: () => workspace.deselectAll(),
    },
    {
      id: 'duplicate-tab',
      label: t('Duplicate tab'),
      hint: shortcuts.hint('app.duplicate-tab'),
      disabled: !tab || !workspace.canDuplicateTab(tab),
      run: () => void tabOps().then((ops) => ops.duplicateTab(id)),
    },
    {
      id: 'rename',
      label: t('Rename'),
      disabled:
        !tab || !workspace.canRenameFromTab(tab) || (tab.path !== null && !canWriteAt(tab.path)),
      run: () => void tabOps().then((ops) => ops.renameFromTab(id)),
    },
    ...(tab && workspace.shownSpaces.length > 1
      ? [
          {
            id: 'move-to-space',
            label: t('Move to space'),
            run: () => void toSpace().then((one) => one.askSpace([id])),
          },
        ]
      : []),
  ]
}

function webCommands(): Command[] {
  if (__EVEN_PLUGIN__) return []

  const tab = workspace.active
  if (!isDesktop || tab?.kind !== 'web') return []

  const page = pages.of(tab.id)
  const rows: [Step, string, string][] = [
    ['reload', t('Reload'), 'web.reload'],
    ['fresh', t('Hard reload'), 'web.fresh'],
  ]
  if (page.loading) rows.push(['stop', t('Stop'), 'web.stop'])
  return [
    ...rows.map(([step, label, key]) => ({
      id: `web-${step}`,
      label,
      hint: shortcuts.hint(key),
      run: () => void pages.step(tab.id, step),
    })),
    {
      id: 'web-find',
      label: t('Find'),
      hint: shortcuts.hint('edit.find'),
      run: () => (page.find.open = true),
    },
    {
      id: 'web-mute',
      label: page.muted ? t('Unmute site') : t('Mute site'),
      hint: shortcuts.hint('web.mute'),
      run: () => void import('./web-tab/mute').then((one) => one.muteSite(tab.id, !page.muted)),
    },
    {
      id: 'web-clear-data',
      label: t('Delete browsing data'),
      hint: shortcuts.hint('web.clear-data'),
      run: () =>
        void import('./web-tab/clearing-asked.svelte').then((one) => one.clearingAsked.ask(tab.id)),
    },
    {
      id: 'web-devtools',
      label: t('Developer tools'),
      hint: shortcuts.hint('web.devtools'),
      run: () => void invoke('web_devtools', { tab: tab.id }).catch(() => undefined),
    },
  ]
}

function paneCommands(): Command[] {
  if (viewport.touch) return []

  return [
    {
      id: 'split-right',
      label: t('Split right'),
      hint: shortcuts.hint('pane.split-right'),
      disabled: !workspace.canSplit('row'),
      run: () => workspace.split('row'),
    },
    {
      id: 'split-down',
      label: t('Split down'),
      hint: shortcuts.hint('pane.split-down'),
      disabled: !workspace.canSplit('column'),
      run: () => workspace.split('column'),
    },
    {
      id: 'move-tab-pane',
      label: t('Move to other pane'),
      hint: shortcuts.hint('pane.move-tab'),
      disabled: !workspace.canMoveToOtherPane(workspace.activeTabId ?? ''),
      run: () => void tabOps().then((ops) => ops.moveToOtherPane(workspace.activeTabId ?? '')),
    },
    {
      id: 'focus-pane',
      label: t('Other pane'),
      hint: shortcuts.hint('pane.focus-next'),
      disabled: workspace.panes.count < 2,
      run: () => workspace.panes.focusNext(),
    },
    {
      id: 'stack-tabs',
      label: workspace.stacked() ? t('Unstack tabs') : t('Stack tabs'),
      checked: workspace.stacked(),
      disabled: !workspace.canStack(),
      run: () => workspace.toggleStacked(),
    },
    {
      id: 'close-pane',
      label: t('Close this pane'),
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
      label: t('Save layout'),
      run: () => void askForLayoutName(),
    },
    ...saved.map((one) => ({
      id: `layout:${one.name}`,
      label: t('Layout: {name}', { name: one.name }),
      run: () => void workspace.useLayout(one.name),
    })),
    {
      id: 'delete-layout',
      label: t('Delete a layout'),
      disabled: !saved.length,
      run: () => void askWhichLayoutToDelete(),
    },
  ]
}

async function askForLayoutName() {
  const name = await prompt.ask({
    title: t('Name this layout'),
    placeholder: t('Reading'),
    confirmLabel: key('Save'),
  })

  if (name) workspace.saveLayout(name)
}

async function askWhichLayoutToDelete() {
  const chosen = await prompt.find({
    title: t('Delete a layout'),
    options: workspace.layouts.all.map((one) => ({ id: one.name, label: one.name })),
  })

  if (chosen) workspace.layouts.remove(chosen)
}

function slideCommands(view?: EditorView): Command[] {
  return [
    {
      id: 'present',
      label: present.on ? t('Leave presenting') : t('Present'),
      hint: shortcuts.hint('app.present'),
      disabled: !present.on && !present.available,
      run: () => present.toggle(),
    },
    {
      id: 'new-slide',
      label: t('New slide'),
      disabled: !view || view.state.readOnly,
      run: () => {
        if (!view) return
        insertSlideBreak({ state: view.state, dispatch: (one) => view.dispatch(one) })
        view.focus()
      },
    },
    {
      id: 'next-slide',
      label: t('Next slide'),
      disabled: !view || !present.available,
      run: () => view && stepSlide(view, 1),
    },
    {
      id: 'previous-slide',
      label: t('Previous slide'),
      disabled: !view || !present.available,
      run: () => view && stepSlide(view, -1),
    },
  ]
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
    fold('view.fold', t('Fold'), toggleFold),
    fold('view.fold-all', t('Fold everything'), foldHeadings),
    fold('view.fold-more', t('Fold more'), foldMore),
    fold('view.fold-less', t('Fold less'), foldLess),
    fold('view.unfold-all', t('Unfold everything'), unfoldEverything),
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
    row('edit.expand-selection', t('Expand the selection'), expandSelection, false),
    row('edit.shrink-selection', t('Shrink the selection'), shrinkSelection, false),
    row('edit.select-word', t('Select the word, then the next'), selectWord, false),
    row('edit.insert-line-above', t('Insert a line above'), insertLineAbove),
    row('edit.delete-line', t('Delete the line'), deleteLine),
    row('edit.join-lines', t('Join the lines'), joinLines),
    row('edit.sort-lines', t('Sort the lines'), sortLines),
    row('edit.reverse-lines', t('Reverse the lines'), reverseLines),
    row('edit.upper-case', t('Upper case'), upperCase),
    row('edit.lower-case', t('Lower case'), lowerCase),
    row('edit.title-case', t('Title case'), titleCase),
    row('edit.duplicate-block', t('Duplicate the block'), duplicateBlock),
    row('edit.move-block-up', t('Move the block up'), moveBlockUp),
    row('edit.move-block-down', t('Move the block down'), moveBlockDown),
    row('edit.undo', t('Undo'), undoEdit),
    row('edit.redo', t('Redo'), redoEdit),
    row('format.inline-math', t('Inline math'), toggleWrap('$')),
    row('format.superscript', t('Superscript'), toggleWrap('^')),
    row('format.subscript', t('Subscript'), toggleWrap('~')),
    row('edit.paste-plain', t('Paste as plain text'), pastePlain),
    row('edit.find-next', t('Find next'), findNext, false),
    row('edit.find-previous', t('Find previous'), findPrevious, false),
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

const BLOCKS: Block[] = [
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    block(`paragraph.heading-${level}`, () => t('Heading {level}', { level }), setHeading(level)),
  ),
  block('paragraph.body', () => t('Paragraph'), setHeading(0)),
  block('paragraph.heading-up', () => t('One heading level up'), shiftHeading(1)),
  block('paragraph.heading-down', () => t('One heading level down'), shiftHeading(-1)),
  {
    id: 'paragraph.table',
    label: () => t('Table'),
    apply: (view) => {
      if (view) insertTableToEdit(view)
    },
  },
  block('paragraph.code-block', () => t('Code block'), insertCodeFence),
  block('paragraph.quote', () => t('Quote'), toggleQuote),
  block('paragraph.math-block', () => t('Math block'), insertMathBlock),
  block('paragraph.chart', () => t('Chart'), insertChart),
  block('ai-block', () => t('AI block'), insertAiBlock),
  block('paragraph.callout', () => t('Callout'), insertCallout),
  block('paragraph.bullet-list', () => t('Bulleted list'), toggleBulletList),
  block('paragraph.ordered-list', () => t('Numbered list'), toggleOrderedList),
  block('paragraph.task-list', () => t('Task list'), toggleTaskList),
  {
    id: 'picture',
    label: () => t('Picture'),
    apply: (view) => {
      if (view) void insertPicture(view)
    },
    ready: (view) => canInsertPicture(view),
  },
  {
    id: 'photo',
    label: () => t('Photo'),
    apply: (view) => {
      if (view) void takePhoto(view)
    },
    ready: (view) => canTakePhoto(view),
    byHand: true,
  },
  {
    id: 'dictate',
    label: () => (dictating() ? t('Stop') : t('Dictate')),
    apply: (view) => {
      if (view) void toggleDictation(view)
    },
    ready: (view) => canDictate(view),
    byHand: true,
  },
  { id: 'record', label: recordLabel, apply: () => void record(), ready: canRecord, byHand: true },
  block('format.link', () => t('Link'), insertLink),
  block('paragraph.footnote', () => t('Footnote'), insertFootnote),
  block('paragraph.toc', () => t('Table of contents'), insertToc),
  block('format.comment', () => t('Comment'), insertComment),
  block('paragraph.rule', () => t('Horizontal rule'), insertHorizontalRule),
  block('slide-break', () => t('New slide'), insertSlideBreak),
  block('page-break', () => t('Page break'), insertPageBreak),
]

export function blockCommands(view?: EditorView): Command[] {
  return BLOCKS.map((one) => {
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
  return BLOCKS.map((one) => ({ label: one.label(), run: one.apply }))
}

function stepSlide(view: EditorView, direction: number) {
  const slides = deckOf(view.state.doc.toString())
  if (slides.length < 2) return

  const here = slideAt(slides, view.state.selection.main.head)
  const wanted = slides[Math.max(0, Math.min(here + direction, slides.length - 1))]
  if (!wanted) return

  view.dispatch({
    selection: { anchor: wanted.from },
    effects: EditorView.scrollIntoView(wanted.from, { y: 'start', yMargin: 72 }),
  })
  view.focus()
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
      return toSpace().then((one) => one.toSpace([note.id], space.id))
    }
    await workspace.moveMany([path], into)
  }

  return {
    id: 'move-note',
    label: t('Move this note'),
    run: () =>
      void prompt
        .find({ title: t('Move to'), options: [...targets] })
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
          label: t('Space: {name}', { name: one.name }),
          checked: one.id === space.id,
          run: () => void workspace.showSpace(one.id),
        }))
      : []),
    { id: 'new-space', label: t('New space'), run: () => void newSpace() },
    ...(canShare(space)
      ? [{ id: 'share', label: t('Share this space'), run: () => void shareSpace(space) }]
      : []),
    ...(isDesktop && !__EVEN_PLUGIN__ && internal.routed?.('read_tree', { root: space.root })
      ? [
          {
            id: 'export-space',
            label: t('Export this space as Markdown and folders'),
            run: () =>
              busy.start(
                t('Exporting'),
                async () => {
                  const [{ exportSpace }, { listedAt }] = await Promise.all([
                    import('./internal/export'),
                    import('./rows/todo-lists'),
                  ])
                  const items = workspace.itemMeta.itemsOf(space.root)
                  const metaOf = (path: string) => items[path] ?? null
                  const { homeRoot } = await import('./rows/home.svelte')
                  const home = homeRoot()
                  const inbox =
                    home !== null && samePath(home, space.root)
                      ? await (
                          await import('./inbox/account.svelte')
                        ).accountInbox
                          .text()
                          .catch(() => null)
                      : null
                  await exportSpace(
                    space.root,
                    space.name,
                    metaOf,
                    (path) => listedAt(space.root, path, metaOf(path)),
                    inbox,
                  )
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
            label: t('Share this note'),
            run: () => void shareThisFile(workspace.active?.path ?? ''),
          },
        ]
      : []),
    ...(canPublish(space)
      ? [
          {
            id: 'publish',
            label: t('Publish this space as a blog'),
            run: () => publishSpace(space),
          },
        ]
      : []),
  ]
}

function sendToChatCommand(view?: EditorView): Command[] {
  const tab = workspace.active
  const note = tab?.kind === 'note' ? tab.path : null
  if (__EVEN_PLUGIN__ || !note || !account.accountToken || !chatsOn()) return []
  const run = () => {
    const range = view?.state.selection.main
    void import('./chats/send').then(({ sendSelection, sendToChat }) =>
      view && range && !range.empty
        ? sendSelection(note, view.state.doc.toString(), range.from, range.to)
        : sendToChat(note),
    )
  }
  return [{ id: 'send-to-chat', label: t('Send to chat'), run }]
}

export function tidies(path: string | null): boolean {
  return path === null || isMarkdownPath(path)
}

export function appCommands(view?: EditorView): Command[] {
  const imported = importCommand()

  const unsaved = workspace.active && isUnsaved(workspace.active.note) ? workspace.active : null
  const space = workspace.activeSpace
  const readOnly = space ? !canWriteAt(space.root) : false

  return without([
    ...(unsaved
      ? [
          {
            id: 'save',
            label: t('Save'),
            hint: shortcuts.saveHint,
            run: () => askPlace(unsaved.id),
          },
        ]
      : []),
    {
      id: 'new',
      label: t('New note'),
      hint: shortcuts.hint('app.new'),
      run: () => workspace.openBlank(),
    },
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'quick-add',
            label: t('Add task'),
            hint: shortcuts.hint('app.quick-add'),
            run: () => showQuickAdd(),
          },
        ]),
    ...sendToChatCommand(view),
    {
      id: 'new-unique',
      label: t('New unique note'),
      disabled: readOnly,
      run: () => void workspace.createUniqueNote(settings.noteIdFormat),
    },
    {
      id: 'new-canvas',
      label: t('New canvas'),
      disabled: readOnly,
      run: () => void workspace.createCanvas(),
    },
    {
      id: 'new-pages',
      label: t('New page note'),
      disabled: readOnly,
      run: () => void workspace.createPages(),
    },
    ...(basesOn()
      ? [
          {
            id: 'new-database',
            label: t('New database'),
            disabled: readOnly,
            run: () => void import('./views/new-database').then((one) => one.createDatabase()),
          },
        ]
      : []),
    {
      id: 'new-from-template',
      label: t('New note from template'),
      disabled: readOnly,
      run: () => void import('./views/templates').then((one) => one.pickTemplate()),
    },
    ...(viewport.touch
      ? []
      : [
          {
            id: 'new-web-note',
            label: t('New web note'),
            disabled: readOnly,
            run: () => void workspace.createWebsite(),
          },
          {
            id: 'new-website',
            label: t('Open a website'),
            run: () => workspace.openWebsite(),
          },
        ]),
    ...(!__EVEN_PLUGIN__ && isDesktop && modes.coder
      ? [
          {
            id: 'new-terminal',
            label: t('New terminal'),
            ownWindow: true,
            run: () => void import('./terminal/open').then(({ openTerminal }) => openTerminal()),
          },
          {
            id: 'new-remote',
            label: t('Remote'),
            ownWindow: true,
            run: () =>
              void import('./remote/picker.svelte').then(({ hostPicker }) => hostPicker.toggle()),
          },
        ]
      : []),
    ...(__EVEN_PLUGIN__ || !modes.coder
      ? []
      : [
          {
            id: 'new-online-terminal',
            label: t('New online terminal'),
            ownWindow: true,
            run: () => void import('./online/open').then(({ openOnline }) => openOnline()),
          },
          {
            id: 'start-online-machine',
            label: t('Start online machine'),
            ownWindow: true,
            run: () =>
              void import('./online/machine.svelte').then(({ machine }) => machine.startStop(true)),
          },
          {
            id: 'stop-online-machine',
            label: t('Stop online machine'),
            ownWindow: true,
            run: () =>
              void import('./online/machine.svelte').then(({ machine }) =>
                machine.startStop(false),
              ),
          },
        ]),
    ...(links.websiteNotes
      ? [
          {
            id: 'convert-website-notes',
            label: t('Convert website notes'),
            disabled: readOnly,
            run: () => void workspace.convertWebsites(),
          },
        ]
      : []),
    {
      id: 'random-note',
      label: t('Random note'),
      hint: shortcuts.hint('app.random-note'),
      disabled: !randomChoices().length,
      run: () => openRandomNote(),
    },
    ...(imported ? [imported] : []),
    ...migrateCommands(),
    {
      id: 'convert-syntax',
      label: t('Convert syntax'),
      disabled: readOnly,
      run: () => void import('./convert-syntax').then((m) => m.convertSyntax()),
    },
    ...(canPrint
      ? [
          {
            id: 'print',
            label: t('Print'),
            hint: shortcuts.hint('app.print'),
            disabled: !printable(workspace.active?.kind) || frontShut(),
            run: () => busy.start(t('Printing'), () => printOpen(), 'print'),
          },
        ]
      : []),
    {
      id: 'close',
      label: t('Close note'),
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeActive(),
    },
    ...archiveCommand(),
    ...listCommand(),
    ...protectCommands(),
    ...tabCommands(),
    {
      id: 'back',
      label: t('Back'),
      hint: shortcuts.hint('app.back'),
      disabled: !workspace.active?.canGoBack,
      run: () => workspace.goBack(),
    },
    {
      id: 'forward',
      label: t('Forward'),
      hint: shortcuts.hint('app.forward'),
      disabled: !workspace.active?.canGoForward,
      run: () => workspace.goForward(),
    },
    {
      id: 'reopen',
      label: t('Reopen closed tab'),
      hint: shortcuts.hint('app.reopen'),
      disabled: !workspace.closed.any,
      run: () => void workspace.reopenClosed(),
    },
    { id: 'space', label: t('New space'), run: () => void newSpace() },
    ...webCommands(),
    ...paneCommands(),
    ...layoutCommands(),
    {
      id: 'new-window',
      label: t('New window'),
      hint: shortcuts.hint('app.new-window'),
      disabled: !isDesktop,
      run: () => void invoke('new_window').catch(() => undefined),
    },
    {
      id: 'close-window',
      label: t('Close window'),
      hint: shortcuts.hint('app.close-window'),
      disabled: !isDesktop,
      run: () => void closeWindow(),
    },
    {
      id: 'new-private',
      label: t('New private tab'),
      hint: shortcuts.hint('app.new-private'),
      disabled: !isDesktop || viewport.touch,
      run: () => void import('./web-tab/private').then(({ openPrivate }) => openPrivate()),
    },
    {
      id: 'web-history',
      label: t('Browsing history'),
      hint: shortcuts.hint('web.history'),
      disabled: viewport.touch,
      run: () => void import('./web-tab/history-open').then((one) => one.openHistory()),
    },
    {
      id: 'undo-file',
      label: workspace.undoLabel ?? t('Undo the last file change'),
      disabled: !workspace.undoLabel,
      run: () => void workspace.undoFileAction(),
    },
    {
      id: 'redo-file',
      label: t('Redo the last file change'),
      disabled: !workspace.canRedo,
      run: () => void workspace.redoFileAction(),
    },
    {
      id: 'settings',
      label: t('Settings'),
      hint: shortcuts.hint('app.settings'),
      run: () => settings.show(),
    },
    {
      id: 'feedback',
      label: t('Send feedback'),
      also: ['feedback', 'bug', 'report'],
      run: showFeedback,
    },
    {
      id: 'shortcuts',
      label: t('Shortcuts'),
      hint: shortcuts.hint('app.keys'),
      run: () => settings.show('shortcuts'),
    },
    {
      id: 'history',
      label: t('Version history'),
      disabled: !workspace.active?.path || frontShut(),
      run: () => (settings.historyOpen = true),
    },
    ...agentUndoRows(),
    ...agentRows(),
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'copy-uri',
            label: t('Copy link to this note'),
            disabled: !workspace.active?.path,
            run: () => void import('./automation/link').then((m) => m.copyNoteLink()),
          },
        ]),

    ...exportCommands(),
    ...spaceCommands(),
    { id: 'llm', label: t('Connect an LLM to your notes'), run: () => settings.show('llm') },

    account.user
      ? {
          id: 'signout',
          label: `${t('Sign out')} ${account.user.email}`.trim(),
          byHand: true,
          run: () =>
            __EVEN_PLUGIN__
              ? void account.signOut('asked')
              : void import('./ai/vault/leaving').then((one) => one.signOut()),
        }
      : { id: 'signin', label: t('Sign in'), run: () => (account.open = true) },

    {
      id: 'reformat',
      label: t('Tidy up this note'),
      disabled: !view || view.state.readOnly || !tidies(workspace.active?.path ?? null),
      run: () =>
        view &&
        reformatDocument({
          state: view.state,
          dispatch: (transaction: Transaction) => view.dispatch(transaction),
        }),
    },

    ...blockCommands(view),
    ...slideCommands(view),
    ...foldingCommands(view),
    ...lineCommands(view),
    {
      id: 'reading',
      label: workspace.active?.reading ? t('Leave reading') : t('Reading'),
      hint: shortcuts.hint('app.reading'),
      disabled: workspace.active?.kind !== 'note',
      run: () => workspace.toggleReading(),
    },
    {
      id: 'read-only',
      label: modes.readOnly ? t('Leave read-only') : t('Read-only'),
      hint: shortcuts.hint('app.read-only'),
      run: () => modes.toggleReadOnly(view),
    },
    {
      id: 'source',
      label: modes.sourceIn(view) ? t('Leave source mode') : t('Source mode'),
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
    {
      id: 'focus',
      label: modes.focus ? t('Leave focus mode') : t('Focus mode'),
      hint: shortcuts.hint('app.focus'),
      run: () => modes.toggleFocus(view),
    },
    {
      id: 'typewriter',
      label: modes.typewriter ? t('Leave typewriter mode') : t('Typewriter mode'),
      hint: shortcuts.hint('app.typewriter'),
      run: () => modes.toggleTypewriter(view),
    },
    ...(viewport.touch
      ? []
      : [
          {
            id: 'full-window',
            label: workspace.panes.fills === null ? t('Full window') : t('Leave full window'),
            hint: shortcuts.hint('app.fill-tab'),
            disabled: workspace.panes.fills === null && !workspace.activeTabId,
            run: () => void toggleFill(),
          },
        ]),
    {
      id: 'fullscreen',
      label: fullscreen.on ? t('Leave fullscreen') : t('Fullscreen'),
      hint: shortcuts.hint('app.fullscreen'),
      run: () => void fullscreen.toggle(workspace.panes),
    },
    ...(isDesktop
      ? [
          {
            id: 'always-on-top',
            label: t('Always on top'),
            checked: modes.alwaysOnTop,
            run: () => modes.toggleAlwaysOnTop(),
          },
        ]
      : []),

    {
      id: 'punctuation',
      label: modes.punctuation ? t('Use straight quotes') : t('Use curly quotes'),
      run: () => modes.togglePunctuation(view),
    },
    {
      id: 'numbers',
      label: modes.numbers ? t('Stop numbering headings') : t('Number headings'),
      run: () => modes.toggleNumbers(view),
    },

    {
      id: 'line-numbers',
      label: modes.lineNumbers ? t('Hide code line numbers') : t('Show code line numbers'),
      run: () => modes.toggleLineNumbers(view),
    },
    {
      id: 'rtl',
      label: modes.rtl ? t('Write left to right') : t('Write right to left'),
      run: () => modes.toggleRightToLeft(view),
    },
    {
      id: 'strict',
      label: modes.strict ? t('Allow extended markdown') : t('Strict CommonMark only'),
      run: () => modes.toggleStrict(view),
    },
    {
      id: 'equation-numbers',
      label: modes.equationNumbers ? t('Stop numbering equations') : t('Number equations'),
      run: () => modes.toggleEquationNumbers(view),
    },
    { id: 'wider', label: t('Wider writing area'), run: () => modes.stepWidth(1, view) },
    { id: 'narrower', label: t('Narrower writing area'), run: () => modes.stepWidth(-1, view) },
    { id: 'looser', label: t('Looser line spacing'), run: () => modes.stepLineHeight(1, view) },
    { id: 'tighter', label: t('Tighter line spacing'), run: () => modes.stepLineHeight(-1, view) },

    {
      id: 'zoom-in',
      label: t('Zoom in'),
      hint: shortcuts.hint('app.zoom-in'),
      run: () => workspace.zoomPage('in') || modes.stepZoom(1),
    },
    {
      id: 'zoom-out',
      label: t('Zoom out'),
      hint: shortcuts.hint('app.zoom-out'),
      run: () => workspace.zoomPage('out') || modes.stepZoom(-1),
    },
    {
      id: 'zoom-reset',
      label: t('Actual size'),
      hint: shortcuts.hint('app.zoom-reset'),
      run: () => workspace.zoomPage('reset') || modes.resetZoom(),
    },

    ...(isDesktop
      ? [
          {
            id: 'window-frame',
            label: t('Window frame'),
            run: () => modes.setFrame(modes.frame === 'system' ? 'orden' : 'system'),
          },
        ]
      : []),

    {
      id: 'themes',
      label: t('Switch theme'),
      run: () => void import('./theme-picker/picking.svelte').then((one) => one.pickTheme()),
    },
    ...theme.all.map((item) => ({
      id: `theme:${item.id}`,
      label: t('Theme: {name}', { name: t(item.name) }),
      checked: item.id === theme.id,
      run: () => theme.select(item.id),
    })),
    ...switchableAccounts().map((one) => ({
      id: `ai-account:${one.id}`,
      label: t('AI account: {name}', { name: one.label }),
      checked: one.active,
      run: () => switchAccount(one.id),
    })),
    ...SCHEME_CHOICES.map((choice) => ({
      id: `scheme:${choice}`,
      label: t('Mode: {name}', { name: t(SCHEME_NAMES[choice]) }),
      checked: choice === theme.shown,
      disabled: !theme.offers(choice),
      run: () => theme.setScheme(choice),
    })),
    ...(theme.accentIsTheme
      ? []
      : theme.accents.map((swatch) => ({
          id: `accent:${swatch.id}`,
          label: t('Accent: {name}', { name: t(swatch.name) }),
          checked: swatch.id === theme.accent,
          run: () => theme.setAccent(swatch.id),
        }))),
    ...CODE_PALETTES.map((palette) => ({
      id: `code-theme:${palette.id}`,
      label: t('Code theme: {name}', { name: palette.name }),
      checked: palette.id === modes.codeTheme,
      run: () => modes.setCodeTheme(palette.id, view),
    })),
    ...(isDesktop
      ? [
          {
            id: 'themes-folder',
            label: t('Open themes folder'),
            run: () => void openThemesFolder(),
          },
        ]
      : []),
    ...(isNative
      ? [
          { id: 'custom-css', label: t('Edit custom CSS'), run: () => void openCustomCss() },
          { id: 'snippets', label: t('Edit snippets'), run: () => void openSnippets() },
        ]
      : []),
    ...(isDesktop
      ? [{ id: 'logs', label: t('Open the log file'), run: () => void openLog() }]
      : []),
    {
      id: 'update',
      label: t('Check for updates'),
      disabled: !isDesktop,
      run: () => void updates.check(),
    },
    { id: 'whats-new', label: t('What is new'), run: () => void openExternal(RELEASES_URL) },
    { id: 'report-issue', label: t('Report an issue'), run: () => void openExternal(ISSUES_URL) },
    { id: 'source-code', label: t('Source code'), run: () => void openExternal(SOURCE_URL) },
    {
      id: 'sidebar',
      label: workspace.panel ? t('Hide left sidebar') : t('Show left sidebar'),
      hint: shortcuts.hint('app.sidebar'),
      run: () => workspace.toggleSidebar(),
    },
    {
      id: 'files',
      label: t('Files'),
      hint: shortcuts.hint('app.files'),
      run: () => revealPanel('tree'),
    },
    {
      id: 'reveal',
      label: t('Show in the file list'),
      hint: shortcuts.hint('app.reveal'),
      disabled: !workspace.active?.path,
      run: () => workspace.revealNote(),
    },
    {
      id: 'fold-list',
      label: t('Collapse the file list'),
      hint: shortcuts.hint('app.fold-list'),
      disabled: !workspace.unfolded,
      run: () => workspace.foldList(),
    },
    {
      id: 'outline-panel',
      label: t('Outline'),
      hint: shortcuts.hint('app.outline'),
      run: () => revealPanel('outline'),
    },
    {
      id: 'search-space',
      label: t('Search this space'),
      hint: shortcuts.hint('app.search'),
      run: () => revealPanel('search'),
    },
    {
      id: 'links-panel',
      label: t('Links'),
      hint: shortcuts.hint('app.links'),
      run: () => revealPanel('links'),
    },
    ...(viewport.touch
      ? []
      : [
          {
            id: 'ask-panel',
            label: t('Ask'),
            hint: shortcuts.hint('app.ask'),
            run: () => revealPanel('ask'),
          },
        ]),
    {
      id: 'quick-question',
      label: t('Quick question'),
      hint: shortcuts.hint('app.quick-question'),
      run: () => askQuickly(),
    },
    {
      id: 'reload-app',
      label: t('Reload Orden'),
      hint: shortcuts.hint('app.reload'),
      run: () => location.reload(),
    },
    {
      id: 'scratchpad',
      label: t('Scratchpad'),
      hint: shortcuts.hint('app.scratchpad'),
      run: () => toggleScratchpad(),
    },
    {
      id: 'right-sidebar',
      label: workspace.openOn('right') ? t('Hide right sidebar') : t('Show right sidebar'),
      hint: shortcuts.hint('app.right-sidebar'),
      disabled: !workspace.right.length,
      run: () => workspace.toggleSidebar('right'),
    },
    {
      id: 'hold-panel',
      label: workspace.held ? t('Follow the open note') : t('Stay on this note'),
      checked: workspace.held,
      disabled: workspace.holdablePanel === null,
      run: () => workspace.holdPanel(workspace.held ? null : (workspace.panelTab?.id ?? null)),
    },
    {
      id: 'graph',
      label: t('Graph'),
      hint: shortcuts.hint('app.graph'),
      run: () => workspace.openGraph(),
    },
    ...(__EVEN_PLUGIN__ || !passOn()
      ? []
      : [
          {
            id: 'pass',
            label: t('Pass'),
            hint: shortcuts.hint('app.pass'),
            run: () => void import('./pass/open').then((one) => one.openPass()),
          },
          {
            id: 'pass-lock',
            label: t('Lock Pass'),
            run: () => void import('./pass/open').then((one) => one.lockPass()),
          },
          {
            id: 'pass-new-login',
            label: t('New login'),
            run: () => void import('./pass/open').then((one) => one.openPass('new-login')),
          },
          {
            id: 'pass-generate',
            label: t('Generate password'),
            run: () => void import('./pass/open').then((one) => one.openPass('generator')),
          },
        ]),
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'todos',
            label: t('Tasks'),
            hint: shortcuts.hint('app.tasks'),
            run: () => void import('./todos-entry').then(({ showTodos }) => showTodos()),
          },
          ...(timeOn()
            ? [
                {
                  id: 'time-tab',
                  label: t('Open time tracker'),
                  hint: shortcuts.hint('time.tab'),
                  run: () => void import('./time/open').then(({ openTime }) => openTime()),
                },
                {
                  id: 'time-start',
                  label: t('Start timer'),
                  hint: shortcuts.hint('time.start'),
                  run: () => void import('./time/commands').then(({ startTimer }) => startTimer()),
                },
                {
                  id: 'time-stop',
                  label: t('Stop timer'),
                  hint: shortcuts.hint('time.stop'),
                  run: () => void import('./time/commands').then(({ stopTimer }) => stopTimer()),
                },
              ]
            : []),
        ]),
    {
      id: 'region-next',
      label: t('Next section'),
      hint: shortcuts.hint('app.region-next'),
      run: () => void stepRegionFocus(1),
    },
    {
      id: 'region-previous',
      label: t('Previous section'),
      hint: shortcuts.hint('app.region-previous'),
      run: () => void stepRegionFocus(-1),
    },
    {
      id: 'spaces',
      label: t('Spaces'),
      hint: shortcuts.hint('space.switcher'),
      run: () => spacePicker.toggle(),
    },
    {
      id: 'tab-overview',
      label: t('Tabs'),
      hint: shortcuts.hint('app.tab-overview'),
      run: toggleTabOverview,
    },
    {
      id: 'space-next',
      label: t('Next space'),
      hint: shortcuts.hint('space.next'),
      disabled: workspace.shownSpaces.length < 2,
      run: () => stepSpace(1),
    },
    {
      id: 'space-previous',
      label: t('Previous space'),
      hint: shortcuts.hint('space.previous'),
      disabled: workspace.shownSpaces.length < 2,
      run: () => stepSpace(-1),
    },
    {
      id: 'keys',
      label: t('Keyboard shortcuts'),
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
