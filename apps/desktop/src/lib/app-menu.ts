import {
  clearFormatting,
  type EditorView,
  insertCodeFence,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertPageBreak,
  insertTableToEdit,
  openFind,
  redoEdit,
  setHeading,
  type StateCommand,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleWrap,
  type Transaction,
  undoEdit,
} from '@nib/editor'
import { account } from './account.svelte'
import { exportCommands } from './commands'
import { t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { settings } from './settings.svelte'
import { newSpace } from './space-actions'
import { invoke, isDesktop, openExternal } from './tauri'
import { stageUpdate } from './updater'
import { workspace } from './workspace.svelte'
import { openFile } from './open-file'

/** Where the app is developed, which is the whole of "about" for an open
 *  source editor. */
export const SOURCE_URL = 'https://github.com/lxorb/nib'

export interface MenuAction {
  label: string
  hint?: string
  checked?: boolean
  disabled?: boolean
  run(): void
}

/** A rule between groups of actions. */
export const SPLIT = null
export type MenuRow = MenuAction | typeof SPLIT

export interface MenuGroup {
  id: string
  label: string
  rows: MenuRow[]
}

interface Context {
  view?: EditorView
  onpalette(): void
  onhistory(): void
}

/** Runs an editor command against whichever view is on screen. */
function run(view: EditorView | undefined, command: StateCommand) {
  if (!view) return

  command({ state: view.state, dispatch: (one: Transaction) => view.dispatch(one) })
  view.focus()
}

/** Everything the app can do, arranged the way a menu bar arranges it.
 *
 *  Built fresh each time it opens so the ticks and the greying-out describe
 *  the moment rather than whenever the app started. Every row here calls the
 *  same code the keyboard and the command palette already call - the menu is
 *  another way in, not a second implementation. */
export function appMenu(context: Context): MenuGroup[] {
  const { view } = context
  const hasNote = !!workspace.active
  const selected = !!view && !view.state.selection.main.empty

  const heading = (level: number): MenuAction => ({
    label: t('Heading {level}', { level }),
    hint: `Ctrl ${level}`,
    disabled: !view,
    run: () => run(view, setHeading(level)),
  })

  return [
    {
      id: 'file',
      label: t('File'),
      rows: [
        { label: t('New note'), hint: 'Ctrl N', run: () => workspace.openBlank() },
        { label: t('Open file'), hint: 'Ctrl O', run: () => void openFile() },
        { label: t('New space'), run: () => void newSpace() },
        ...(isDesktop
          ? [
              {
                label: t('New window'),
                hint: 'Ctrl Shift N',
                run: () => void invoke('new_window'),
              },
            ]
          : []),
        SPLIT,
        { label: t('Save'), hint: 'Ctrl S', disabled: !hasNote, run: () => void workspace.save() },
        {
          label: t('Save notes as I type'),
          checked: workspace.autoSave,
          run: () => workspace.setAutoSave(!workspace.autoSave),
        },
        {
          label: t('Rename'),
          disabled: !workspace.active?.path,
          run: () => (workspace.renaming = workspace.active?.path ?? null),
        },
        SPLIT,
        ...exportCommands().map((one) => ({ label: one.label, run: one.run })),
        SPLIT,
        { label: t('Version history'), disabled: !hasNote, run: () => context.onhistory() },
        { label: t('Settings'), hint: 'Ctrl ,', run: () => settings.show() },
        SPLIT,
        {
          label: t('Close note'),
          hint: 'Ctrl W',
          disabled: !hasNote,
          run: () => workspace.active && workspace.close(workspace.active.id),
        },
      ],
    },

    {
      id: 'edit',
      label: t('Edit'),
      rows: [
        { label: t('Undo'), hint: 'Ctrl Z', disabled: !view, run: () => view && undoEdit(view) },
        { label: t('Redo'), hint: 'Ctrl Y', disabled: !view, run: () => view && redoEdit(view) },
        SPLIT,
        {
          label: t('Cut'),
          hint: 'Ctrl X',
          disabled: !selected,
          run: () => document.execCommand('cut'),
        },
        {
          label: t('Copy'),
          hint: 'Ctrl C',
          disabled: !selected,
          run: () => document.execCommand('copy'),
        },
        SPLIT,
        {
          label: t('Select all'),
          hint: 'Ctrl A',
          disabled: !view,
          run: () =>
            view?.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
        },
        SPLIT,
        {
          label: t('Find'),
          hint: 'Ctrl F',
          disabled: !view,
          run: () => view && openFind(view),
        },
        { label: t('Search'), hint: 'Ctrl Shift F', run: () => workspace.showPanel('search') },
      ],
    },

    {
      id: 'paragraph',
      label: t('Paragraph'),
      rows: [
        heading(1),
        heading(2),
        heading(3),
        heading(4),
        heading(5),
        heading(6),
        { label: t('Paragraph'), disabled: !view, run: () => run(view, setHeading(0)) },
        SPLIT,
        // Not through `run`: the new table takes the focus into its first cell,
        // and focusing the editor afterwards would take it straight back out.
        { label: t('Table'), hint: 'Ctrl T', disabled: !view, run: () => view && insertTableToEdit(view) },
        { label: t('Code block'), disabled: !view, run: () => run(view, insertCodeFence) },
        { label: t('Quote'), disabled: !view, run: () => run(view, toggleQuote) },
        { label: t('Math block'), disabled: !view, run: () => run(view, insertMathBlock) },
        SPLIT,
        { label: t('Bulleted list'), disabled: !view, run: () => run(view, toggleBulletList) },
        { label: t('Numbered list'), disabled: !view, run: () => run(view, toggleOrderedList) },
        SPLIT,
        {
          label: t('Horizontal rule'),
          disabled: !view,
          run: () => run(view, insertHorizontalRule),
        },
        { label: t('Page break'), disabled: !view, run: () => run(view, insertPageBreak) },
      ],
    },

    {
      id: 'format',
      label: t('Format'),
      rows: [
        { label: t('Bold'), hint: 'Ctrl B', disabled: !view, run: () => run(view, toggleWrap('**')) },
        { label: t('Italic'), hint: 'Ctrl I', disabled: !view, run: () => run(view, toggleWrap('*')) },
        {
          label: t('Strikethrough'),
          disabled: !view,
          run: () => run(view, toggleWrap('~~')),
        },
        { label: t('Highlight'), disabled: !view, run: () => run(view, toggleWrap('==')) },
        SPLIT,
        { label: t('Code'), disabled: !view, run: () => run(view, toggleWrap('`')) },
        { label: t('Inline math'), disabled: !view, run: () => run(view, toggleWrap('$')) },
        { label: t('Superscript'), disabled: !view, run: () => run(view, toggleWrap('^')) },
        { label: t('Subscript'), disabled: !view, run: () => run(view, toggleWrap('~')) },
        SPLIT,
        { label: t('Link'), hint: 'Ctrl K', disabled: !view, run: () => run(view, insertLink) },
        SPLIT,
        {
          label: t('Clear formatting'),
          hint: 'Ctrl \\',
          disabled: !view,
          run: () => run(view, clearFormatting),
        },
      ],
    },

    {
      id: 'view',
      label: t('View'),
      rows: [
        { label: t('Command palette'), hint: 'Ctrl P', run: () => context.onpalette() },
        SPLIT,
        {
          label: t('Source mode'),
          hint: 'Ctrl /',
          checked: modes.source,
          run: () => modes.toggleSource(view),
        },
        {
          label: t('Typewriter mode'),
          checked: modes.typewriter,
          run: () => modes.toggleTypewriter(view),
        },
        { label: t('Focus mode'), checked: modes.focus, run: () => modes.toggleFocus(view) },
        SPLIT,
        {
          label: t('Show sidebar'),
          hint: 'Ctrl B',
          checked: !!workspace.panel,
          run: () => workspace.toggleSidebar(),
        },
        { label: t('Files'), run: () => workspace.showPanel('tree') },
        { label: t('Outline'), run: () => workspace.showPanel('outline') },
        SPLIT,
        { label: t('Zoom in'), hint: 'Ctrl Shift =', run: () => modes.stepZoom(1) },
        { label: t('Zoom out'), hint: 'Ctrl Shift -', run: () => modes.stepZoom(-1) },
        { label: t('Actual size'), hint: 'Ctrl Shift 0', run: () => modes.resetZoom() },
      ],
    },

    {
      id: 'help',
      label: t('Help'),
      rows: [
        {
          label: account.signedIn ? t('Sign out') : t('Sign in'),
          run: () => (account.signedIn ? void account.signOut() : (account.open = true)),
        },
        SPLIT,
        ...(isDesktop
          ? [{ label: t('Check for updates'), run: () => void stageUpdate() }]
          : []),
        { label: t('Source code'), run: () => void openExternal(SOURCE_URL) },
      ],
    },
  ]
}
