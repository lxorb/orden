import {
  CODE_PALETTES,
  EditorView,
  insertSlideBreak,
  reformatDocument,
  type Transaction,
} from '@nib/editor'
import { deckOf, slideAt } from '@nib/markdown/slides'
import { present } from './slides/present.svelte'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { composerCommands } from './composer-commands'
import { key, t } from './i18n.svelte'
import type { HtmlOptions } from './export'
import type { Exportable } from './export/formats'
import { type ExportId, exportKindOf, isNoteFormat, labelOf, offeredBy } from './export/offer'
import type { RunOptions } from './export/run'
import { PANDOC_FORMATS } from './export-formats'
import { imagePath } from './images'
import { links } from './link-index.svelte'
import { prompt } from './prompt.svelte'
import { newSpace, shareSpace } from './space-actions'
import { canShare } from './sharing.svelte'
import { stageUpdate } from './updater'
import { modes } from './modes.svelte'
import { settings } from './settings.svelte'
import { shortcuts } from './shortcuts.svelte'
import { invoke, isDesktop, isNative } from './tauri'
import { theme } from './theme.svelte'
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

/** How an exported page should look: the colours chosen for export, or the
 *  ones on screen right now, theme file and custom CSS included. */
async function look(): Promise<Pick<HtmlOptions, 'scheme' | 'accent' | 'codeTheme' | 'css'>> {
  const chosen = { accent: theme.accent, codeTheme: modes.codeTheme }
  if (settings.exportAppearance !== 'app') return { ...chosen, scheme: settings.exportAppearance }

  const file = theme.active.path
  const sheets = await Promise.all([
    file ? invoke<string>('read_theme', { path: file }).catch(() => '') : '',
    isNative ? invoke<string>('read_custom_css').catch(() => '') : '',
  ])

  return { ...chosen, scheme: theme.current, css: sheets.filter((css) => css.trim()).join('\n') }
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
  const note = () => workspace.active
  // Flushed first: the editor's last few keystrokes are still a rope until
  // something asks for them as text, and an export is asking.
  const source = () => {
    workspace.flush()
    return note()?.doc ?? ''
  }
  const name = () => note()?.name ?? 'Untitled.md'
  const target = () => ({ source: source(), name: name(), path: note()?.path ?? null })

  /** What is open, which is what decides the rows. Read once: the list is built
   *  fresh every time the menu or the palette opens, and a document does not
   *  become another kind while its own menu is on screen. */
  const open = note()
  const kind = exportKindOf(open ? { kind: open.kind, path: open.path, text: source() } : null)

  /** Everything an export needs beyond the note: paper, colours, where the
   *  pictures it names actually are, and where its links point. */
  const options = async (): Promise<RunOptions> => ({
    page: settings.page,
    resolveImage: (src: string) => imagePath(src, note()?.path, source()) ?? src,
    // An `![[Note]]` in the document brings that note into it, the way it shows
    // in the editor. Read here rather than in the renderer, which is sync.
    readNote: (target: string) => links.embedSource(target, note()?.path ?? null),
    // A wikilink written out as markdown points at the file it named, relative
    // to this note, so the export reads in any other editor.
    link: (link) => links.relativeTarget(link, note()?.path ?? null),
    ...(await look()),
  })

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

  // Importing makes a note of its own and has nothing to do with what is open,
  // so it is offered whatever that is.
  commands.push({
    id: 'import',
    label: t('Import a document'),
    run: () =>
      busy.start(t('Importing'), async () => {
        const m = await import('./export')
        const imported = await m.importDocument()
        if (imported) workspace.openBlank(imported.name, imported.markdown)
      }),
  })

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
/** Sharing the space that is open, when there is one and it is this account's
 *  to share. A list rather than a disabled row, because a command that cannot
 *  run is not a command; see `exportCommands`. */
function shareCommand(): Command[] {
  const space = workspace.activeSpace
  if (!space || !canShare(space)) return []

  return [{ id: 'share', label: t('Share this space'), run: () => void shareSpace(space) }]
}

export function appCommands(view?: EditorView): Command[] {
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
        label: `Recent: ${
          path
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.[^.]+$/, '') ?? path
        }`,
        run: () => void workspace.openEntry(path),
      })),

    ...exportCommands(),
    ...shareCommand(),
    {
      id: 'publish',
      label: t('Publish this space as a blog'),
      run: () => settings.show('publish'),
    },
    { id: 'llm', label: t('Connect an LLM to your notes'), run: () => settings.show('llm') },

    account.signedIn
      ? {
          id: 'signout',
          label: `${t('Sign out')} ${account.user?.email ?? ''}`.trim(),
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

    ...slideCommands(view),
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

    ...theme.all.map((item) => ({
      id: `theme:${item.id}`,
      label: `Theme: ${item.name}`,
      hint: item.id === theme.id ? 'current' : undefined,
      run: () => theme.select(item.id),
    })),
    ...theme.accents.map((swatch) => ({
      id: `accent:${swatch.id}`,
      label: t('Accent: {name}', { name: t(swatch.name) }),
      hint: swatch.id === theme.accent ? 'current' : undefined,
      run: () => theme.setAccent(swatch.id),
    })),
    ...CODE_PALETTES.map((palette) => ({
      id: `code-theme:${palette.id}`,
      label: `Code theme: ${palette.name}`,
      hint: palette.id === modes.codeTheme ? 'current' : undefined,
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
      run: () => void stageUpdate(),
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
