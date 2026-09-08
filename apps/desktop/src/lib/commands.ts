import {
  CODE_PALETTES,
  EditorView,
  insertSlideBreak,
  reformatDocument,
  type Transaction,
} from '@nib/editor'
import { deckOf, isDeck, slideAt } from '@nib/markdown/slides'
import { present } from './slides/present.svelte'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { composerCommands } from './composer-commands'
import { key, t } from './i18n.svelte'
import type { HtmlOptions } from './export'
import { PANDOC_FORMATS } from './export-formats'
import { imagePath } from './images'
import { links } from './link-index.svelte'
import { prompt } from './prompt.svelte'
import { newSpace } from './space-actions'
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

/** Export entries. The pandoc formats only appear when pandoc is installed,
 *  so the list never offers something that cannot work. */
export function exportCommands(): Command[] {
  const note = () => workspace.active
  // Flushed first: the editor's last few keystrokes are still a rope until
  // something asks for them as text, and an export is asking.
  const source = () => {
    workspace.flush()
    return note()?.doc ?? ''
  }
  const name = () => note()?.name ?? 'Untitled.md'

  /** Everything an export needs beyond the note: paper, colours, and where
   *  the pictures it names actually are. */
  const options = async (): Promise<HtmlOptions> => ({
    page: settings.page,
    resolveImage: (src: string) => imagePath(src, note()?.path, source()) ?? src,
    // An `![[Note]]` in the document brings that note into it, the way it shows
    // in the editor. Read here rather than in the renderer, which is sync.
    readNote: (target: string) => links.embedSource(target, note()?.path ?? null),
    ...(await look()),
  })

  // Rendering a note and handing it to the system takes a moment with nothing
  // on screen to show for it, so each of these runs behind the line at the top
  // of the document. See busy.svelte.ts.
  const commands: Command[] = [
    {
      id: 'export-pdf',
      label: t('Export as PDF'),
      run: () =>
        busy.start(t('Exporting'), async () => {
          const m = await import('./export')
          await m.exportPdf(source(), name(), await options())
        }),
    },
    {
      id: 'export-html',
      label: t('Export as HTML'),
      run: () =>
        busy.start(t('Exporting'), async () => {
          const m = await import('./export')
          await m.exportHtml(source(), name(), await options())
        }),
    },
    { id: 'page-setup', label: t('Page setup for export'), run: () => settings.show('export') },
    {
      id: 'export-html-bare',
      label: t('Export as HTML without styles'),
      run: () =>
        busy.start(t('Exporting'), async () => {
          const m = await import('./export')
          await m.exportHtml(source(), name(), { bare: true })
        }),
    },
  ]

  // A deck goes out as slides as well: one file that turns its own pages, and
  // one page of paper per slide. Only offered for a note that is a deck, since
  // for anything else the two rows would do the same as the two above them.
  if (isDeck(source())) {
    const deck = () => ({ text: source(), path: note()?.path ?? null })
    const deckOptions = async () => ({
      resolveImage: (src: string) => imagePath(src, note()?.path, source()) ?? src,
      ...(await look()),
    })

    commands.push(
      {
        id: 'export-slides-html',
        label: t('Export slides as HTML'),
        run: () =>
          busy.start(t('Exporting'), async () => {
            const m = await import('./slides/file')
            await m.exportDeck(deck(), name(), await deckOptions())
          }),
      },
      {
        id: 'export-slides-pdf',
        label: t('Export slides as PDF'),
        run: () =>
          busy.start(t('Exporting'), async () => {
            const m = await import('./slides/file')
            await m.exportDeckPdf(deck(), name(), await deckOptions())
          }),
      },
    )
  }

  if (!settings.pandoc) return commands

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

  for (const format of PANDOC_FORMATS) {
    commands.push({
      id: `export-${format.id}`,
      label: t('Export as {format}', { format: t(format.label) }),
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
  if (viewport.phone) return []

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
  if (viewport.phone) return []

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
      id: 'autosave',
      label: workspace.autoSave ? t('Turn off auto-save') : t('Turn on auto-save'),
      run: () => workspace.setAutoSave(!workspace.autoSave),
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
