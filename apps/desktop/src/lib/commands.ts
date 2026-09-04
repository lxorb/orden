import { CODE_PALETTES, type EditorView, reformatDocument, type Transaction } from '@nib/editor'
import { account } from './account.svelte'
import { t } from './i18n.svelte'
import type { HtmlOptions } from './export'
import { PANDOC_FORMATS } from './export-formats'
import { imagePath } from './images'
import { newSpace } from './space-actions'
import { stageUpdate } from './updater'
import { modes } from './modes.svelte'
import { settings } from './settings.svelte'
import { invoke, isDesktop } from './tauri'
import { theme } from './theme.svelte'
import { workspace } from './workspace.svelte'

/** Opens `custom.css` in the editor itself - it is a text file like any other. */
async function openCustomCss() {
  if (!isDesktop) return

  const path = await invoke<string>('custom_css_path')
  await workspace.open(path)
}

/** Opens `snippets.json`, and reloads it once the file is saved. */
async function openSnippets() {
  if (!isDesktop) return

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
    isDesktop ? invoke<string>('read_custom_css').catch(() => '') : '',
  ])

  return { ...chosen, scheme: theme.current, css: sheets.filter((css) => css.trim()).join('\n') }
}

/** Export entries. The pandoc formats only appear when pandoc is installed,
 *  so the list never offers something that cannot work. */
export function exportCommands(): Command[] {
  const note = () => workspace.active
  const source = () => note()?.doc ?? ''
  const name = () => note()?.name ?? 'Untitled.md'

  /** Everything an export needs beyond the note: paper, colours, and where
   *  the pictures it names actually are. */
  const options = async (): Promise<HtmlOptions> => ({
    page: settings.page,
    resolveImage: (src: string) => imagePath(src, note()?.path, source()) ?? src,
    ...(await look()),
  })

  const commands: Command[] = [
    {
      id: 'export-pdf',
      label: t('Export as PDF'),
      run: () =>
        void import('./export').then(async (m) => m.exportPdf(source(), name(), await options())),
    },
    {
      id: 'export-html',
      label: t('Export as HTML'),
      run: () =>
        void import('./export').then(async (m) => m.exportHtml(source(), name(), await options())),
    },
    { id: 'page-setup', label: t('Page setup for export'), run: () => settings.show('export') },
    {
      id: 'export-html-bare',
      label: t('Export as HTML without styles'),
      run: () => void import('./export').then((m) => m.exportHtml(source(), name(), { bare: true })),
    },
  ]

  if (!settings.pandoc) return commands

  commands.push({
    id: 'import',
    label: t('Import a document'),
    run: () =>
      void import('./export').then(async (m) => {
        const imported = await m.importDocument()
        if (imported) workspace.openBlank(imported.name, imported.markdown)
      }),
  })

  for (const format of PANDOC_FORMATS) {
    commands.push({
      id: `export-${format.id}`,
      label: t('Export as {format}', { format: t(format.label) }),
      run: () => void import('./export').then((m) => m.exportPandoc(source(), name(), format.id)),
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
  hint?: string
  disabled?: boolean
  run(): void
}

/** Everything the palette can do. Labels read as the action, not the setting. */
export function appCommands(view?: EditorView): Command[] {
  return [
    { id: 'save', label: t('Save'), hint: 'Ctrl S', run: () => void workspace.save() },
    { id: 'new', label: t('New note'), hint: 'Ctrl N', run: () => workspace.openBlank() },
    {
      id: 'close',
      label: t('Close note'),
      hint: 'Ctrl W',
      run: () => workspace.activeTabId && workspace.close(workspace.activeTabId),
    },
    { id: 'space', label: t('New space'), run: () => void newSpace() },
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
    { id: 'settings', label: t('Settings'), hint: 'Ctrl ,', run: () => settings.show() },
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
        label: `Recent: ${path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? path}`,
        run: () => void workspace.open(path),
      })),

    ...exportCommands(),
    { id: 'publish', label: t('Publish this space as a blog'), run: () => settings.show('publish') },
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
      disabled: !view,
      run: () =>
        view &&
        reformatDocument({
          state: view.state,
          dispatch: (transaction: Transaction) => view.dispatch(transaction),
        }),
    },

    {
      id: 'source',
      label: modes.source ? t('Leave source mode') : t('Source mode'),
      hint: 'Ctrl /',
      run: () => modes.toggleSource(view),
    },
    {
      id: 'focus',
      label: modes.focus ? t('Leave focus mode') : t('Focus mode'),
      hint: 'F8',
      run: () => modes.toggleFocus(view),
    },
    {
      id: 'typewriter',
      label: modes.typewriter ? t('Leave typewriter mode') : t('Typewriter mode'),
      hint: 'F9',
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

    { id: 'zoom-in', label: t('Zoom in'), hint: 'Ctrl Shift =', run: () => modes.stepZoom(1) },
    { id: 'zoom-out', label: t('Zoom out'), hint: 'Ctrl Shift -', run: () => modes.stepZoom(-1) },
    { id: 'zoom-reset', label: t('Actual size'), hint: 'Ctrl Shift 0', run: () => modes.resetZoom() },

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
      hint: 'Ctrl Shift L',
      run: () => workspace.toggleSidebar(),
    },
    { id: 'files', label: t('Files'), hint: 'Ctrl Shift 3', run: () => workspace.showPanel('tree') },
    {
      id: 'search-space',
      label: t('Search this space'),
      hint: 'Ctrl Shift F',
      run: () => workspace.showPanel('search'),
    },
  ]
}
