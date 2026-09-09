import {
  CODE_PALETTES,
  EditorView,
  foldHeadings,
  insertCallout,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertPageBreak,
  insertSlideBreak,
  insertTableToEdit,
  insertToc,
  reformatDocument,
  setHeading,
  shiftHeading,
  type SlashBlock,
  type StateCommand,
  toggleBulletList,
  toggleFold,
  toggleOrderedList,
  toggleQuote,
  toggleTaskList,
  type Transaction,
  unfoldEverything,
} from '@nib/editor'
import { deckOf, slideAt } from '@nib/markdown/slides'
import { present } from './slides/present.svelte'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { composerCommands } from './composer-commands'
import { key, t } from './i18n.svelte'
import type { Exportable } from './export/formats'
import { look, openTarget, renderOptions } from './export/context'
import { type ExportId, exportKindOf, isNoteFormat, labelOf, offeredBy } from './export/offer'
import type { RunOptions } from './export/run'
import { PANDOC_FORMATS } from './export-formats'
import { canPrint, printNote } from './export/print'
import { imagePath } from './images'
import { canInsertPicture, insertPicture } from './insert-picture'
import { canSaveAs, saveAs } from './save-as'
import { prompt } from './prompt.svelte'
import { newSpace, publishSpace, shareSpace } from './space-actions'
import { canPublish } from './publishing.svelte'
import { canShare } from './sharing.svelte'
import { updates } from './updates.svelte'
import { modes } from './modes.svelte'
import { settings } from './settings.svelte'
import { shortcuts } from './shortcuts.svelte'
import { invoke, isDesktop, isNative } from './tauri'
import { SCHEME_CHOICES, SCHEME_NAMES, theme } from './theme.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'
import { openFile } from './open-file'

/** Opens `custom.css` in the editor itself - it is a text file like any other. */
async function openCustomCss() {
  if (!isNative) return

  const path = await invoke<string>('custom_css_path')
  await workspace.open(path)
}

/** Opens `snippets.json`, and reloads it once the file is saved. */
async function openSnippets() {
  if (!isNative) return

  const path = await invoke<string>('snippets_path')
  await workspace.open(path)
}

/** Export entries: what this document goes out as, in the fixed order its kind
 *  keeps, then the variants, then the paper.
 *
 *  Which rows those are is offer.ts, read here and nowhere else, so the File
 *  menu, the palette and a key on the keyboard cannot come to different answers
 *  about a canvas. The pandoc formats only appear when pandoc is installed and
 *  the document is a note, so the list never offers something that cannot work;
 *  everything above them works on every build with nothing installed. */
export function exportCommands(): Command[] {
  // Not in the plugin, which cannot save a file: a WebView on a phone has nowhere
  // to put one. Answered before anything else so the bundler takes the whole of
  // what is below with it - the renderers, the document libraries, and the URLs
  // and `new Function` calls the store's review found in them. See
  // vite.even.config.ts.
  if (__EVEN_PLUGIN__) return []

  const note = () => workspace.active
  // Flushed first: the editor's last few keystrokes are still a rope until
  // something asks for them as text, and an export is asking.
  const source = () => {
    workspace.flush()
    return note()?.doc ?? ''
  }
  const name = () => note()?.name ?? 'Untitled.md'
  const target = openTarget

  /** What is open, which is what decides the rows. Read once: the list is built
   *  fresh every time the menu or the palette opens, and a document does not
   *  become another kind while its own menu is on screen. */
  const open = note()
  const kind = exportKindOf(open ? { kind: open.kind, path: open.path, text: source() } : null)

  /** Everything an export needs beyond the note: paper, colours, where the
   *  pictures it names actually are, and where its links point. Shared with
   *  printing, which is the same page through the same renderer; see
   *  export/context.ts. */
  const options = (): Promise<RunOptions> => renderOptions(target())

  /** The note, one of the ten formats or a variant of one. */
  const noteOut = async (id: Exportable) => {
    const m = await import('./export/run')
    await m.runExport(id, target(), await options())
  }

  /** The deck: one file that turns its own pages, or one sheet of paper per
   *  slide. Both come out of the slides code, which builds them from one page. */
  const slidesOut = async (id: 'slides-html' | 'slides-pdf') => {
    const m = await import('./slides/file')
    const deck = { text: source(), path: note()?.path ?? null }
    const options = {
      resolveImage: (src: string) => imagePath(src, note()?.path, source()) ?? src,
      ...(await look()),
    }

    if (id === 'slides-html') await m.exportDeck(deck, name(), options)
    else await m.exportDeckPdf(deck, name(), options)
  }

  /** The plane, drawn. One SVG, and the PNG and the PDF made out of it; see
   *  canvas/picture.ts, which is where the context menu on the plane goes too. */
  const drawingOut = async (id: ExportId) => {
    const [picture, { drawingOf }] = await Promise.all([
      import('./canvas/picture'),
      import('./export/drawing'),
    ])

    const drawing = drawingOf({
      text: source(),
      name: name(),
      path: note()?.path ?? null,
      root: workspace.activeSpace?.root ?? null,
    })

    if (id === 'png') await picture.exportCanvasPng(drawing)
    else if (id === 'svg') await picture.exportCanvasSvg(drawing)
    else if (id === 'pdf') await picture.exportCanvasPdf(drawing)
  }

  /** A paper or a picture the app is only showing, handed over as it stands. */
  const copyOut = async () => {
    const path = note()?.path
    if (path === null || path === undefined) return

    const m = await import('./export/copy')
    await m.saveCopy(path, name())
  }

  /** One export, behind the line at the top of the document: rendering a note
   *  and handing it to the system takes a moment with nothing on screen to show
   *  for it. See busy.svelte.ts.
   *
   *  Whose code answers is the kind's business. A drawing is drawn even when the
   *  row says PNG, which is the same word a note's picture goes out under: one
   *  row, one meaning, and the document decides what it is a picture of. */
  const run = (id: ExportId) => () =>
    busy.start(t('Exporting'), async () => {
      if (kind === 'canvas') await drawingOut(id)
      else if (id === 'slides-html' || id === 'slides-pdf') await slidesOut(id)
      else if (id === 'copy') await copyOut()
      else if (isNoteFormat(id)) await noteOut(id)
    })

  const offered = offeredBy(kind)
  // Nothing here goes out as anything: the graph of a space, or a pane with
  // nothing in it. The rows a note would have are shown greyed out rather than
  // taken away, so the Export menu keeps its shape and says no the way Save and
  // Rename already do with no note open.
  const nothing = offered.length === 0
  /** Whether these are a note's rows, which is what the paper and pandoc are for.
   *  A drawing has no paper, and a copy is the bytes that are already there. */
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

  if (!settings.pandoc) return commands

  // Pandoc converts markdown, so it has as little to say about a drawing as Word
  // has. A note's rows get pandoc's; the other kinds keep their own.
  if (!asNote) return commands

  for (const format of PANDOC_FORMATS) {
    commands.push({
      id: `export-${format.id}`,
      label: t('Export as {format}', { format: t(format.label) }),
      disabled: nothing,
      run: () =>
        busy.start(t('Exporting'), async () => {
          const m = await import('./export')
          await m.exportPandoc(source(), name(), format.id)
        }),
    })
  }

  return commands
}

/** Reading another kind of document in as a note: Word, ODT, ePub, LaTeX and the
 *  rest, through pandoc, which is what reads them.
 *
 *  A row in File rather than in Export, because importing makes a note of its own
 *  and has nothing to do with what is open - it belongs beside Open file, which is
 *  the other way a document that is not yet a note becomes one. Null on a machine
 *  with no pandoc: a row that cannot work is not a row. */
export function importCommand(): Command | null {
  if (!settings.pandoc) return null

  return {
    id: 'import',
    label: t('Import a document'),
    run: () =>
      busy.start(t('Importing'), async () => {
        const m = await import('./export')
        const imported = await m.importDocument()
        if (imported) workspace.openBlank(imported.name, imported.markdown)
      }),
  }
}

/** Shows the log file in the file manager, for when something has gone wrong. */
async function openLog() {
  if (!isDesktop) return

  const path = await invoke<string>('log_dir')
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path)
}

/** Reveals the folder a `.css` theme should be dropped into. */
async function openThemesFolder() {
  if (!isDesktop) return

  const dir = await invoke<string>('theme_dir')
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(dir)
  await theme.reload()
}

export interface Command {
  id: string
  label: string
  /** The key that runs it, when it has one. `shortcuts.hint` answers
   *  undefined for an unbound command, so undefined is a real value here. */
  hint?: string | undefined
  /** Whether this row is the one already in force: the theme in use, the accent
   *  it is drawn in. A tick, the same one the menu rows carry. */
  checked?: boolean
  disabled?: boolean
  // A property rather than a method, so a caller may hand the function on -
  // the app menu passes an export row straight through as a row of its own.
  run: () => void
}

/** Splitting, moving between panes, and closing one. Left out entirely on a
 *  phone, which shows one note at a time and has no panes to talk about. */
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
      id: 'focus-pane',
      label: t('Other pane'),
      hint: shortcuts.hint('pane.focus-next'),
      disabled: workspace.panes.count < 2,
      run: () => workspace.panes.focusNext(),
    },
    {
      id: 'close-pane',
      label: t('Close this pane'),
      disabled: workspace.panes.count < 2,
      run: () => void workspace.closePane(),
    },
  ]
}

/** Arrangements: keeping this one under a name, going back to one, and letting
 *  one go. A saved layout reads as what it will do - "Layout: reading" - so the
 *  palette needs no heading to say what the row is. */
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

/** Presenting a deck, and the three things a deck needs while it is written.
 *
 *  A note becomes a deck by having a rule in it, so New slide is the way in and
 *  is offered for any note; the rest only make sense once there are slides. */
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

/** Fold, fold everything, unfold everything - the whole of folding, as three
 *  rows. What each of them does and why there are three is in fold.ts. */
function foldingCommands(view?: EditorView): Command[] {
  const fold = (id: string, label: string, command: StateCommand): Command => ({
    id,
    label,
    hint: shortcuts.hint(id),
    disabled: !view,
    run: () => {
      if (!view) return
      command({ state: view.state, dispatch: (one: Transaction) => view.dispatch(one) })
      view.focus()
    },
  })

  return [
    fold('view.fold', t('Fold'), toggleFold),
    fold('view.fold-all', t('Fold everything'), foldHeadings),
    fold('view.unfold-all', t('Unfold everything'), unfoldEverything),
  ]
}

/** One block a note can be written out of.
 *
 *  `apply` takes the view rather than closing over one, because the same block
 *  is offered in three places and one of them - the editor's `/` menu - runs it
 *  against whichever pane it opened in, which is not always the pane the row was
 *  built for. `label` is a thunk for the same reason it is in the shortcut
 *  registry: the words follow the language without the list being rebuilt. */
interface Block {
  id: string
  label: () => string
  apply: (view: EditorView) => void
  /** Whether a view can take it. A block writes, so the default is a view that
   *  is not read-only. */
  ready?: (view: EditorView | undefined) => boolean
}

/** A state command as something to do to a view. */
function on(command: StateCommand) {
  return (view: EditorView) => {
    command({ state: view.state, dispatch: (one: Transaction) => view.dispatch(one) })
    view.focus()
  }
}

function block(id: string, label: () => string, command: StateCommand): Block {
  return { id, label, apply: on(command) }
}

/** Every block and mark a note is written out of, as one list.
 *
 *  Three ways in read from this and nothing else: the Paragraph menu, the
 *  command palette, and the `/` menu in the editor. A row in one of them and not
 *  the others is a thing you can only reach if you already know where it is, and
 *  a second list is how that happens. The ids are the shortcut ids, so a row's
 *  key and its words can never say different things.
 *
 *  In the order the Paragraph menu shows them, which is the order the `/` menu
 *  offers them in before anything is typed. */
const BLOCKS: Block[] = [
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    block(`paragraph.heading-${level}`, () => t('Heading {level}', { level }), setHeading(level)),
  ),
  block('paragraph.body', () => t('Paragraph'), setHeading(0)),
  block('paragraph.heading-up', () => t('One heading level up'), shiftHeading(1)),
  block('paragraph.heading-down', () => t('One heading level down'), shiftHeading(-1)),
  // Not through `on`: a new table takes the focus into its first cell, and
  // focusing the editor afterwards would take it straight back out.
  {
    id: 'paragraph.table',
    label: () => t('Table'),
    apply: (view) => {
      insertTableToEdit(view)
    },
  },
  block('paragraph.code-block', () => t('Code block'), insertCodeFence),
  block('paragraph.quote', () => t('Quote'), toggleQuote),
  block('paragraph.math-block', () => t('Math block'), insertMathBlock),
  block('paragraph.callout', () => t('Callout'), insertCallout),
  block('paragraph.bullet-list', () => t('Bulleted list'), toggleBulletList),
  block('paragraph.ordered-list', () => t('Numbered list'), toggleOrderedList),
  block('paragraph.task-list', () => t('Task list'), toggleTaskList),
  // The picker is the app's, not the editor's, and it has its own reason to be
  // greyed out: a note it can write beside. No key either, since the one that
  // looks like it writes empty picture markup rather than choosing a file.
  {
    id: 'picture',
    label: () => t('Picture'),
    apply: (view) => void insertPicture(view),
    ready: (view) => canInsertPicture(view),
  },
  block('format.link', () => t('Link'), insertLink),
  block('paragraph.footnote', () => t('Footnote'), insertFootnote),
  block('paragraph.toc', () => t('Table of contents'), insertToc),
  block('paragraph.front-matter', () => t('Front matter'), insertFrontMatter),
  block('format.comment', () => t('Comment'), insertComment),
  block('paragraph.rule', () => t('Horizontal rule'), insertHorizontalRule),
  // A new slide is a rule with a blank line above it, which is what breaks a
  // deck into its next one; see packages/markdown/src/slides.ts.
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
      disabled: !ready,
      run: () => {
        if (view) one.apply(view)
      },
    }
  })
}

/** The same blocks as the editor's `/` menu takes them: words and something to
 *  do to the view the menu opened in. */
export function blockRows(): SlashBlock[] {
  return BLOCKS.map((one) => ({ label: one.label(), run: one.apply }))
}

/** Puts the caret on the slide before or after the one it is in. Writing a deck
 *  is writing a note, so this moves through the note rather than opening
 *  anything: there is one editor, and the slides are places in it. */
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

/** Everything the palette can do. Labels read as the action, not the setting. */
/** What can be done to the space that is open: handing it to somebody, and
 *  putting it on the web. Both need a space on the account and this account to
 *  own it, and both are the sheet the space's own menu opens. A list rather than
 *  a disabled row, because a command that cannot run is not a command; see
 *  `exportCommands`. */
function spaceCommands(): Command[] {
  const space = workspace.activeSpace
  if (!space) return []

  return [
    ...(canShare(space)
      ? [{ id: 'share', label: t('Share this space'), run: () => void shareSpace(space) }]
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

export function appCommands(view?: EditorView): Command[] {
  const imported = importCommand()

  return [
    {
      id: 'save',
      label: t('Save'),
      hint: shortcuts.hint('app.save'),
      run: () => void workspace.save(),
    },
    {
      id: 'new',
      label: t('New note'),
      hint: shortcuts.hint('app.new'),
      run: () => workspace.openBlank(),
    },
    {
      id: 'new-unique',
      label: t('New unique note'),
      run: () => void workspace.createUniqueNote(settings.noteIdFormat),
    },
    { id: 'new-canvas', label: t('New canvas'), run: () => void workspace.createCanvas() },
    {
      id: 'open',
      label: t('Open file'),
      hint: shortcuts.hint('app.open'),
      run: () => void openFile(),
    },
    ...(imported ? [imported] : []),
    ...(canPrint
      ? [
          {
            id: 'print',
            label: t('Print'),
            hint: shortcuts.hint('app.print'),
            disabled: workspace.active?.kind !== 'note',
            run: () => busy.start(t('Printing'), () => printNote()),
          },
        ]
      : []),
    {
      id: 'save-as',
      label: t('Save as'),
      disabled: !canSaveAs(),
      run: () => void saveAs(),
    },
    {
      id: 'close',
      label: t('Close note'),
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeActive(),
    },
    {
      id: 'reopen',
      label: t('Reopen closed tab'),
      hint: shortcuts.hint('app.reopen'),
      disabled: !workspace.closed.any,
      run: () => void workspace.reopenClosed(),
    },
    { id: 'space', label: t('New space'), run: () => void newSpace() },
    ...paneCommands(),
    ...layoutCommands(),
    {
      id: 'new-window',
      label: t('New window'),
      disabled: !isDesktop,
      run: () => void invoke('new_window').catch(() => undefined),
    },
    {
      id: 'undo-file',
      label: workspace.undoLabel ?? t('Undo the last file change'),
      disabled: !workspace.undoLabel,
      run: () => void workspace.undoFileAction(),
    },
    {
      id: 'settings',
      label: t('Settings'),
      hint: shortcuts.hint('app.settings'),
      run: () => settings.show(),
    },
    { id: 'shortcuts', label: t('Shortcuts'), run: () => settings.show('shortcuts') },
    {
      id: 'history',
      label: t('Version history'),
      disabled: !workspace.active?.path,
      run: () => (settings.historyOpen = true),
    },

    ...workspace.recent
      .filter((path) => !workspace.tabs.some((tab) => tab.path === path))
      .slice(0, 8)
      .map((path) => ({
        id: `recent:${path}`,
        label: t('Recent: {name}', {
          name:
            path
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.[^.]+$/, '') ?? path,
        }),
        run: () => void workspace.openEntry(path),
      })),

    ...exportCommands(),
    ...spaceCommands(),
    { id: 'llm', label: t('Connect an LLM to your notes'), run: () => settings.show('llm') },

    account.user
      ? {
          id: 'signout',
          label: `${t('Sign out')} ${account.user.email}`.trim(),
          run: () => void account.signOut(),
        }
      : { id: 'signin', label: t('Sign in'), run: () => (account.open = true) },

    {
      id: 'reformat',
      label: t('Tidy up this note'),
      // Rewriting the whole note is an edit, whatever it is called.
      disabled: !view || view.state.readOnly,
      run: () =>
        view &&
        reformatDocument({
          state: view.state,
          dispatch: (transaction: Transaction) => view.dispatch(transaction),
        }),
    },

    ...blockCommands(view),
    ...slideCommands(view),
    // Folding changes what is on screen and never the note, so these three are
    // not among the writing rows above and are not greyed out on a note nobody
    // may write in. See fold.ts in the editor package.
    ...foldingCommands(view),
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
      label: modes.source ? t('Leave source mode') : t('Source mode'),
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
      run: () => modes.stepZoom(1),
    },
    {
      id: 'zoom-out',
      label: t('Zoom out'),
      hint: shortcuts.hint('app.zoom-out'),
      run: () => modes.stepZoom(-1),
    },
    {
      id: 'zoom-reset',
      label: t('Actual size'),
      hint: shortcuts.hint('app.zoom-reset'),
      run: () => modes.resetZoom(),
    },

    // A theme, an accent and a code theme carry a name rather than a word, so
    // the row reads "Design: Sepia" in German and not "Theme: Sepia". The one in
    // force is ticked, which is the mark the menu rows already use: a word in the
    // key's place would be a word to read where a shape says it.
    ...theme.all.map((item) => ({
      id: `theme:${item.id}`,
      label: t('Theme: {name}', { name: t(item.name) }),
      checked: item.id === theme.id,
      run: () => theme.select(item.id),
    })),
    // Whether the app is dark, light, or whatever the system is asking for. A
    // row each rather than one that flips, so the keyboard reaches the same
    // three the pane offers, and off where the theme in force cannot show it.
    ...SCHEME_CHOICES.map((choice) => ({
      id: `scheme:${choice}`,
      label: t('Mode: {name}', { name: t(SCHEME_NAMES[choice]) }),
      checked: choice === theme.shown,
      disabled: !theme.offers(choice),
      run: () => theme.setScheme(choice),
    })),
    ...theme.accents.map((swatch) => ({
      id: `accent:${swatch.id}`,
      label: t('Accent: {name}', { name: t(swatch.name) }),
      checked: swatch.id === theme.accent,
      run: () => theme.setAccent(swatch.id),
    })),
    ...CODE_PALETTES.map((palette) => ({
      id: `code-theme:${palette.id}`,
      label: t('Code theme: {name}', { name: palette.name }),
      checked: palette.id === modes.codeTheme,
      run: () => modes.setCodeTheme(palette.id, view),
    })),
    { id: 'themes-folder', label: t('Open themes folder'), run: () => void openThemesFolder() },
    { id: 'custom-css', label: t('Edit custom CSS'), run: () => void openCustomCss() },
    { id: 'snippets', label: t('Edit snippets'), run: () => void openSnippets() },
    { id: 'logs', label: t('Open the log file'), run: () => void openLog() },
    {
      id: 'update',
      label: t('Check for updates'),
      disabled: !isDesktop,
      // Through the store rather than straight to the updater, so somebody who
      // asked is told: a look that downloads a version and says nothing is a
      // command that appears to do nothing at all.
      run: () => void updates.check(),
    },
    {
      id: 'sidebar',
      label: workspace.panel ? t('Hide sidebar') : t('Show sidebar'),
      hint: shortcuts.hint('app.sidebar'),
      run: () => workspace.toggleSidebar(),
    },
    {
      id: 'files',
      label: t('Files'),
      hint: shortcuts.hint('app.files'),
      run: () => workspace.showPanel('tree'),
    },
    {
      id: 'search-space',
      label: t('Search this space'),
      hint: shortcuts.hint('app.search'),
      run: () => workspace.showPanel('search'),
    },
    {
      id: 'links-panel',
      label: t('Links'),
      run: () => workspace.showPanel('links'),
    },
    { id: 'graph', label: t('Graph'), run: () => workspace.openGraph() },

    ...composerCommands(view),
  ]
}
