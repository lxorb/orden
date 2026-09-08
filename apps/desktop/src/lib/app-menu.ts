import {
  clearFormatting,
  type EditorView,
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
  openFind,
  openReplace,
  pasteHere,
  pastePlain,
  redoEdit,
  setHeading,
  shiftHeading,
  type StateCommand,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleTaskList,
  toggleWrap,
  type Transaction,
  undoEdit,
} from '@nib/editor'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { copySelection, cutSelection } from './clipboard'
import { exportCommands, importCommand } from './commands'
import { EXPORT_FORMATS, EXPORT_VARIANTS } from './export/formats'
import { EXPORT_EXTRAS } from './export/offer'
import { canPrint, printNote } from './export/print'
import { t } from './i18n.svelte'
import { canInsertPicture, insertPicture } from './insert-picture'
import { modes } from './modes.svelte'
import { canSaveAs, saveAs } from './save-as'
import { settings } from './settings.svelte'
import { shortcuts } from './shortcuts.svelte'
import { present } from './slides/present.svelte'
import { newSpace } from './space-actions'
import { invoke, isDesktop, openExternal } from './tauri'
import { stageUpdate } from './updater'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'
import { openFile } from './open-file'

/** Where the app is developed, which is the whole of "about" for an open
 *  source editor. */
export const SOURCE_URL = 'https://github.com/lxorb/nibeditor'

/** Where a bug goes, and where a new version says what changed. Both are pages
 *  of the same repository, so neither is a second address to keep in step. */
export const ISSUES_URL = `${SOURCE_URL}/issues`
export const RELEASES_URL = `${SOURCE_URL}/releases`

export interface MenuAction {
  label: string
  /** Undefined where the action has no key bound to it. */
  hint?: string | undefined
  checked?: boolean
  disabled?: boolean
  run: () => void
}

/** A row that opens rows of its own: Export under File, whose list is a dozen
 *  formats and belongs behind one word rather than in front of it. */
export interface MenuSubmenu {
  label: string
  disabled?: boolean
  rows: MenuRow[]
}

/** A rule between groups of actions. */
export const SPLIT = null
export type MenuRow = MenuAction | MenuSubmenu | typeof SPLIT

/** Whether a row leads to more rows. */
export function isSubmenu(row: MenuRow): row is MenuSubmenu {
  return row !== SPLIT && 'rows' in row
}

export interface MenuGroup {
  id: string
  label: string
  rows: MenuRow[]
}

interface Context {
  view?: EditorView | undefined
  onpalette(): void
  onhistory(): void
}

/** The export rows, with a rule wherever the kind of row changes: the formats
 *  this document goes out as, then the variants of two of them, then the paper
 *  and whatever else the machine can do. The list itself is the command list, so
 *  the submenu, the palette and the shortcut settings show the same rows in the
 *  same order, and all three follow what is open; see export/offer.ts. */
function exportRows(): MenuRow[] {
  const formats = new Set<string>(
    [...EXPORT_FORMATS, ...EXPORT_EXTRAS].map((one) => `export-${one.id}`),
  )
  const variants = new Set<string>(EXPORT_VARIANTS.map((one) => `export-${one.id}`))

  const rows: MenuRow[] = []
  let last: string | null = null

  for (const command of exportCommands()) {
    const kind = formats.has(command.id) ? 'format' : variants.has(command.id) ? 'variant' : 'rest'
    if (last !== null && kind !== last) rows.push(SPLIT)
    last = kind

    rows.push({
      label: command.label,
      hint: command.hint,
      disabled: !!command.disabled,
      run: command.run,
    })
  }

  return rows
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
  /** Whether the editor takes an edit at all. Read-only mode says no, and every
   *  row that would write says so by greying out rather than by doing nothing
   *  when it is pressed. */
  const writable = !!view && !view.state.readOnly

  const heading = (level: number): MenuAction => ({
    label: t('Heading {level}', { level }),
    hint: shortcuts.hint(`paragraph.heading-${level}`),
    disabled: !writable,
    run: () => run(view, setHeading(level)),
  })

  /** A row that edits the note, named by the shortcut it carries so the key and
   *  the row can never say different things. */
  const edit = (id: string, label: string, command: StateCommand): MenuAction => ({
    label,
    hint: shortcuts.hint(id),
    disabled: !writable,
    run: () => run(view, command),
  })

  /** A row that runs a command against the view itself rather than against its
   *  state: whether it did anything is its own answer and no business of a row's. */
  const onView = (command: (one: EditorView) => boolean) => () => {
    if (view) command(view)
  }

  /** Importing, which is offered only where pandoc is installed. */
  const imported = importCommand()

  return [
    {
      id: 'file',
      label: t('File'),
      rows: [
        { label: t('New note'), hint: shortcuts.hint('app.new'), run: () => workspace.openBlank() },
        { label: t('New canvas'), run: () => void workspace.createCanvas() },
        { label: t('Open file'), hint: shortcuts.hint('app.open'), run: () => void openFile() },
        ...(imported ? [{ label: imported.label, run: imported.run }] : []),
        { label: t('New space'), run: () => void newSpace() },
        ...(isDesktop
          ? [
              {
                label: t('New window'),
                hint: shortcuts.hint('app.new-window'),
                run: () => void invoke('new_window'),
              },
            ]
          : []),
        SPLIT,
        {
          label: t('Save'),
          hint: shortcuts.hint('app.save'),
          disabled: !hasNote,
          run: () => void workspace.save(),
        },
        { label: t('Save as'), disabled: !canSaveAs(), run: () => void saveAs() },
        {
          label: t('Rename'),
          disabled: !workspace.active?.path,
          run: () => {
            const path = workspace.active?.path
            if (path) workspace.startRenaming(path)
          },
        },
        SPLIT,
        // Export is one word here and a dozen rows behind it. It used to be a
        // menu of its own beside File, which put the formats a note goes out as
        // in the same strip as File, Edit and View - and a person looking for
        // "export" looks under File, because that is where every other editor
        // keeps it. The rows are the export list itself, greyed where the thing
        // on screen does not go out that way.
        { label: t('Export'), rows: exportRows() },
        ...(canPrint
          ? [
              {
                label: t('Print'),
                hint: shortcuts.hint('app.print'),
                disabled: workspace.active?.kind !== 'note',
                run: () => busy.start(t('Printing'), () => printNote()),
              },
            ]
          : []),
        SPLIT,
        { label: t('Version history'), disabled: !hasNote, run: () => context.onhistory() },
        { label: t('Settings'), hint: shortcuts.hint('app.settings'), run: () => settings.show() },
        SPLIT,
        {
          label: t('Close note'),
          hint: shortcuts.hint('app.close'),
          disabled: !hasNote,
          run: () => void workspace.closeActive(),
        },
        {
          label: t('Reopen closed tab'),
          hint: shortcuts.hint('app.reopen'),
          disabled: !workspace.closed.any,
          run: () => void workspace.reopenClosed(),
        },
      ],
    },

    {
      id: 'edit',
      label: t('Edit'),
      rows: [
        {
          label: t('Undo'),
          hint: shortcuts.hint('edit.undo'),
          disabled: !writable,
          run: () => view && undoEdit(view),
        },
        {
          label: t('Redo'),
          hint: shortcuts.hint('edit.redo'),
          disabled: !writable,
          run: () => view && redoEdit(view),
        },
        SPLIT,
        {
          label: t('Cut'),
          hint: shortcuts.hint('fixed.cut'),
          disabled: !selected || !writable,
          run: cutSelection,
        },
        {
          label: t('Copy'),
          hint: shortcuts.hint('fixed.copy'),
          disabled: !selected,
          run: copySelection,
        },
        // Paste, which reads the clipboard rather than riding on a paste event -
        // a menu row has none. Rich by default and plain on the row below it, the
        // same two the keyboard offers.
        {
          label: t('Paste'),
          hint: shortcuts.hint('fixed.paste'),
          disabled: !writable,
          run: onView(pasteHere),
        },
        {
          label: t('Paste as plain text'),
          hint: shortcuts.hint('edit.paste-plain'),
          disabled: !writable,
          run: onView(pastePlain),
        },
        SPLIT,
        {
          label: t('Select all'),
          hint: shortcuts.hint('edit.select-all'),
          disabled: !view,
          run: () => view?.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
        },
        SPLIT,
        {
          label: t('Find'),
          hint: shortcuts.hint('edit.find'),
          disabled: !view,
          run: onView(openFind),
        },
        {
          label: t('Replace'),
          hint: shortcuts.hint('edit.replace'),
          disabled: !writable,
          run: onView(openReplace),
        },
        {
          label: t('Search'),
          hint: shortcuts.hint('app.search'),
          run: () => workspace.showPanel('search'),
        },
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
        { label: t('Paragraph'), disabled: !writable, run: () => run(view, setHeading(0)) },
        edit('paragraph.heading-up', t('One heading level up'), shiftHeading(1)),
        edit('paragraph.heading-down', t('One heading level down'), shiftHeading(-1)),
        SPLIT,
        // Not through `run`: the new table takes the focus into its first cell,
        // and focusing the editor afterwards would take it straight back out.
        {
          label: t('Table'),
          hint: shortcuts.hint('paragraph.table'),
          disabled: !writable,
          run: () => view && insertTableToEdit(view),
        },
        {
          label: t('Code block'),
          hint: shortcuts.hint('paragraph.code-block'),
          disabled: !writable,
          run: () => run(view, insertCodeFence),
        },
        {
          label: t('Quote'),
          hint: shortcuts.hint('paragraph.quote'),
          disabled: !writable,
          run: () => run(view, toggleQuote),
        },
        {
          label: t('Math block'),
          hint: shortcuts.hint('paragraph.math-block'),
          disabled: !writable,
          run: () => run(view, insertMathBlock),
        },
        edit('paragraph.callout', t('Callout'), insertCallout),
        SPLIT,
        {
          label: t('Bulleted list'),
          hint: shortcuts.hint('paragraph.bullet-list'),
          disabled: !writable,
          run: () => run(view, toggleBulletList),
        },
        {
          label: t('Numbered list'),
          hint: shortcuts.hint('paragraph.ordered-list'),
          disabled: !writable,
          run: () => run(view, toggleOrderedList),
        },
        edit('paragraph.task-list', t('Task list'), toggleTaskList),
        SPLIT,
        // Not through `edit`: the picker is the app's, not the editor's, and it has
        // its own reason to be greyed out - a note it can write beside. No hint
        // either: Ctrl+Shift+I writes empty picture markup, which is a different
        // thing from choosing a file, and a row that shows a key has to be the row
        // that key runs.
        {
          label: t('Picture'),
          disabled: !canInsertPicture(view),
          run: () => {
            if (view) void insertPicture(view)
          },
        },
        edit('paragraph.footnote', t('Footnote'), insertFootnote),
        edit('paragraph.toc', t('Table of contents'), insertToc),
        edit('paragraph.front-matter', t('Front matter'), insertFrontMatter),
        SPLIT,
        {
          label: t('Horizontal rule'),
          hint: shortcuts.hint('paragraph.rule'),
          disabled: !writable,
          run: () => run(view, insertHorizontalRule),
        },
        // A rule with a blank line above it, which is what breaks a deck into its
        // next slide; see packages/markdown/src/slides.ts.
        { label: t('New slide'), disabled: !writable, run: () => run(view, insertSlideBreak) },
        { label: t('Page break'), disabled: !writable, run: () => run(view, insertPageBreak) },
      ],
    },

    {
      id: 'format',
      label: t('Format'),
      rows: [
        {
          label: t('Bold'),
          hint: shortcuts.hint('format.bold'),
          disabled: !writable,
          run: () => run(view, toggleWrap('**')),
        },
        {
          label: t('Italic'),
          hint: shortcuts.hint('format.italic'),
          disabled: !writable,
          run: () => run(view, toggleWrap('*')),
        },
        {
          label: t('Strikethrough'),
          hint: shortcuts.hint('format.strikethrough'),
          disabled: !writable,
          run: () => run(view, toggleWrap('~~')),
        },
        {
          label: t('Highlight'),
          hint: shortcuts.hint('format.highlight'),
          disabled: !writable,
          run: () => run(view, toggleWrap('==')),
        },
        SPLIT,
        {
          label: t('Code'),
          hint: shortcuts.hint('format.code'),
          disabled: !writable,
          run: () => run(view, toggleWrap('`')),
        },
        { label: t('Inline math'), disabled: !writable, run: () => run(view, toggleWrap('$')) },
        { label: t('Superscript'), disabled: !writable, run: () => run(view, toggleWrap('^')) },
        { label: t('Subscript'), disabled: !writable, run: () => run(view, toggleWrap('~')) },
        SPLIT,
        {
          label: t('Link'),
          hint: shortcuts.hint('format.link'),
          disabled: !writable,
          run: () => run(view, insertLink),
        },
        edit('format.comment', t('Comment'), insertComment),
        SPLIT,
        {
          label: t('Clear formatting'),
          hint: shortcuts.hint('format.clear'),
          disabled: !writable,
          run: () => run(view, clearFormatting),
        },
      ],
    },

    {
      id: 'view',
      label: t('View'),
      rows: [
        {
          label: t('Command palette'),
          hint: shortcuts.hint('app.palette'),
          run: () => context.onpalette(),
        },
        SPLIT,
        {
          label: t('Reading'),
          hint: shortcuts.hint('app.reading'),
          checked: !!workspace.active?.reading,
          disabled: workspace.active?.kind !== 'note',
          run: () => workspace.toggleReading(),
        },
        {
          label: t('Present'),
          hint: shortcuts.hint('app.present'),
          checked: present.on,
          disabled: !present.on && !present.available,
          run: () => present.toggle(),
        },
        {
          label: t('Read-only'),
          hint: shortcuts.hint('app.read-only'),
          checked: modes.readOnly,
          run: () => modes.toggleReadOnly(view),
        },
        {
          label: t('Source mode'),
          hint: shortcuts.hint('app.source'),
          checked: modes.source,
          run: () => modes.toggleSource(view),
        },
        {
          label: t('Typewriter mode'),
          hint: shortcuts.hint('app.typewriter'),
          checked: modes.typewriter,
          run: () => modes.toggleTypewriter(view),
        },
        {
          label: t('Focus mode'),
          hint: shortcuts.hint('app.focus'),
          checked: modes.focus,
          run: () => modes.toggleFocus(view),
        },
        // A window that stays over everything else, for writing beside whatever is
        // being written about. Only a desktop has a window of its own to raise.
        ...(isDesktop
          ? [
              {
                label: t('Always on top'),
                checked: modes.alwaysOnTop,
                run: () => modes.toggleAlwaysOnTop(),
              },
            ]
          : []),
        SPLIT,
        // The panes. Left out on a phone, which shows one note at a time.
        ...(viewport.touch
          ? []
          : [
              {
                label: t('Split right'),
                hint: shortcuts.hint('pane.split-right'),
                disabled: !workspace.canSplit('row'),
                run: () => workspace.split('row'),
              },
              {
                label: t('Split down'),
                hint: shortcuts.hint('pane.split-down'),
                disabled: !workspace.canSplit('column'),
                run: () => workspace.split('column'),
              },
              {
                label: t('Other pane'),
                hint: shortcuts.hint('pane.focus-next'),
                disabled: workspace.panes.count < 2,
                run: () => workspace.panes.focusNext(),
              },
              SPLIT,
            ]),
        {
          label: t('Show sidebar'),
          hint: shortcuts.hint('app.sidebar'),
          checked: !!workspace.panel,
          run: () => workspace.toggleSidebar(),
        },
        {
          label: t('Files'),
          hint: shortcuts.hint('app.files'),
          run: () => workspace.showPanel('tree'),
        },
        { label: t('Outline'), run: () => workspace.showPanel('outline') },
        SPLIT,
        { label: t('Zoom in'), hint: shortcuts.hint('app.zoom-in'), run: () => modes.stepZoom(1) },
        {
          label: t('Zoom out'),
          hint: shortcuts.hint('app.zoom-out'),
          run: () => modes.stepZoom(-1),
        },
        {
          label: t('Actual size'),
          hint: shortcuts.hint('app.zoom-reset'),
          run: () => modes.resetZoom(),
        },
      ],
    },

    {
      id: 'help',
      label: t('Help'),
      rows: [
        {
          label: account.user ? t('Sign out') : t('Sign in'),
          run: () => (account.user ? void account.signOut() : (account.open = true)),
        },
        SPLIT,
        ...(isDesktop ? [{ label: t('Check for updates'), run: () => void stageUpdate() }] : []),
        { label: t('What is new'), run: () => void openExternal(RELEASES_URL) },
        { label: t('Report an issue'), run: () => void openExternal(ISSUES_URL) },
        { label: t('Source code'), run: () => void openExternal(SOURCE_URL) },
      ],
    },
  ]
}
