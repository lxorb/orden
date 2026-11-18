import {
  clearFormatting,
  type EditorView,
  foldHeadings,
  foldLess,
  findNext,
  findPrevious,
  foldMore,
  highlightSelection,
  insertComment,
  insertLink,
  openFind,
  openReplace,
  pasteHere,
  pastePlain,
  redoEdit,
  type StateCommand,
  toggleFold,
  toggleHighlight,
  toggleWrap,
  undoEdit,
  unfoldEverything,
} from '@orden/editor'
import { commandRows } from '@orden/contracts'
import { HIGHLIGHT_COLOURS } from '@orden/markdown/highlights'
import { account } from '../../accounts/src/api'
import {
  DIVIDER,
  type MenuGroup,
  type MenuItem,
  type MenuRow,
  viewport,
  fullscreen,
} from '../../ui-kit/src/api'
import { copySelection, cutSelection } from '../../ui-controls/src/api'
import { blockCommands } from '../../commands/src/api'
import { isDesktop, isNative, openExternal } from '../../platform/src/api'
import { protection } from '../../protect/src/api'
import {
  canPrint,
  EXPORT_EXTRAS,
  EXPORT_FORMATS,
  EXPORT_VARIANTS,
  printable,
} from '../../export-formats/src/api'
import { modes } from '../../modes/src/api'
import { type AppContext, runEntry, shortcuts } from '../../shortcuts/src/api'
import { DOWNLOAD_URL, ISSUES_URL, RELEASES_URL, SOURCE_URL, updates } from '../../updates/src/api'
import { workspace } from '../../workspace/src/api'

interface Context {
  view?: EditorView | undefined
  onpalette(): void
  onhistory(): void
  app?: AppContext
}

function exportRows(): MenuRow[] {
  const formats = new Set<string>(
    [...EXPORT_FORMATS, ...EXPORT_EXTRAS].map((one) => `export-${one.id}`),
  )
  const variants = new Set<string>(EXPORT_VARIANTS.map((one) => `export-${one.id}`))

  const rows: MenuRow[] = []
  let last: string | null = null

  for (const command of commandRows('export')) {
    const kind = formats.has(command.id) ? 'format' : variants.has(command.id) ? 'variant' : 'rest'
    if (last !== null && kind !== last) rows.push(DIVIDER)
    last = kind

    rows.push({
      label: command.label,
      hint: command.hint,
      asks: true,
      command: command.id.replace(/^export-/, 'export.'),
      disabled: !!command.disabled,
      run: command.run,
    })
  }

  return rows
}

function shut(): boolean {
  return protection.locked(workspace.active?.path)
}

function keyed(id: string): Pick<MenuItem, 'hint' | 'command'> {
  return { hint: shortcuts.hint(id), command: id }
}

function run(view: EditorView | undefined, command: StateCommand) {
  if (!view) return

  command(view)
  view.focus()
}

export function appMenu(context: Context): MenuGroup[] {
  const { view } = context
  const app: AppContext = context.app ?? {
    view,
    palette: () => context.onpalette(),
    fullscreen: () => void fullscreen.toggle(workspace.panes),
  }
  const entry = (id: string) => () => void runEntry(id, app)
  const hasNote = !!workspace.active
  const selected = !!view && !view.state.selection.main.empty
  const writable = !!view && !view.state.readOnly

  const edit = (id: string | null, label: string, command: StateCommand): MenuItem => ({
    label,
    ...(id ? keyed(id) : {}),
    disabled: !writable,
    run: () => run(view, command),
  })
  const go = (id: string, label: string, more: Partial<MenuItem> = {}): MenuItem => ({
    label,
    ...keyed(id),
    run: entry(id),
    ...more,
  })
  const fold = (id: string, label: string, command: StateCommand): MenuItem => ({
    label,
    ...keyed(id),
    run: () => run(view, command),
  })
  const unlessTouch = (rows: MenuRow[]) => (viewport.touch ? [] : rows)

  const onView = (command: (one: EditorView) => boolean) => () => {
    if (view) command(view)
  }

  const written = blockCommands(view)
  const blocks = (...ids: string[]): MenuItem[] =>
    ids.flatMap((id) => {
      const found = written.find((one) => one.id === id)
      if (!found) return []

      return [
        {
          label: found.label,
          ...(found.hint === undefined ? {} : { hint: found.hint }),
          ...(found.id === 'picture' ? { asks: true } : {}),
          command: found.id,
          ...(found.disabled === undefined ? {} : { disabled: found.disabled }),
          run: found.run,
        },
      ]
    })

  return [
    {
      id: 'file',
      label: 'File',
      rows: [
        { label: 'Export', rows: exportRows() },
        ...(canPrint
          ? [
              go('app.print', 'Print', {
                asks: true,
                disabled: !printable(workspace.active?.kind) || shut(),
              }),
            ]
          : []),
        DIVIDER,
        {
          label: 'Version history',
          asks: true,
          disabled: !hasNote || shut(),
          run: () => context.onhistory(),
        },
      ],
    },

    {
      id: 'edit',
      label: 'Edit',
      rows: [
        {
          label: 'Undo',
          ...keyed('edit.undo'),
          disabled: !writable,
          run: () => view && undoEdit(view),
        },
        {
          label: 'Redo',
          ...keyed('edit.redo'),
          disabled: !writable,
          run: () => view && redoEdit(view),
        },
        DIVIDER,
        {
          label: 'Cut',
          ...keyed('fixed.cut'),
          disabled: !selected || !writable,
          run: cutSelection,
        },
        { label: 'Copy', ...keyed('fixed.copy'), disabled: !selected, run: copySelection },
        { label: 'Paste', ...keyed('fixed.paste'), disabled: !writable, run: onView(pasteHere) },
        {
          label: 'Paste as plain text',
          ...keyed('edit.paste-plain'),
          disabled: !writable,
          run: onView(pastePlain),
        },
        DIVIDER,
        {
          label: 'Select all',
          ...keyed('edit.select-all'),
          disabled: !view,
          run: () => view?.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
        },
        DIVIDER,
        {
          label: 'Find',
          ...keyed('edit.find'),
          asks: true,
          disabled: !view,
          run: onView(openFind),
        },
        {
          label: 'Replace',
          ...keyed('edit.replace'),
          asks: true,
          disabled: !writable,
          run: onView(openReplace),
        },
        ...unlessTouch([
          {
            label: 'Find next',
            ...keyed('edit.find-next'),
            disabled: !view,
            run: onView(findNext),
          },
          {
            label: 'Find previous',
            ...keyed('edit.find-previous'),
            disabled: !view,
            run: onView(findPrevious),
          },
        ]),
        go('app.search', 'Search'),
      ],
    },

    {
      id: 'paragraph',
      label: 'Paragraph',
      rows: [
        ...blocks('paragraph.heading-1', 'paragraph.heading-2', 'paragraph.heading-3'),
        ...blocks('paragraph.heading-4', 'paragraph.heading-5', 'paragraph.heading-6'),
        ...blocks('paragraph.body', 'paragraph.heading-up', 'paragraph.heading-down'),
        DIVIDER,
        ...blocks(
          'paragraph.table',
          'paragraph.code-block',
          'paragraph.quote',
          'paragraph.math-block',
          'paragraph.callout',
        ),
        DIVIDER,
        ...blocks('paragraph.bullet-list', 'paragraph.ordered-list', 'paragraph.task-list'),
        DIVIDER,
        ...blocks('picture', 'record', 'paragraph.footnote', 'paragraph.toc'),
        DIVIDER,
        ...blocks('paragraph.rule', 'page-break'),
      ],
    },

    {
      id: 'format',
      label: 'Format',
      rows: [
        edit('format.bold', 'Bold', toggleWrap('**')),
        edit('format.italic', 'Italic', toggleWrap('*')),
        edit('format.strikethrough', 'Strikethrough', toggleWrap('~~')),
        edit('format.highlight', 'Highlight', highlightSelection),
        {
          label: 'Highlight colour',
          disabled: !writable,
          rows: HIGHLIGHT_COLOURS.map((colour) => ({
            label: colour.name,
            checked: colour.tone === modes.highlightTone,
            run: () => {
              modes.setHighlightTone(colour.tone)
              run(view, toggleHighlight(colour))
            },
          })),
        },
        DIVIDER,
        edit('format.code', 'Code', toggleWrap('`')),
        edit(null, 'Inline math', toggleWrap('$')),
        edit(null, 'Superscript', toggleWrap('^')),
        edit(null, 'Subscript', toggleWrap('~')),
        DIVIDER,
        edit('format.link', 'Link', insertLink),
        edit('format.comment', 'Comment', insertComment),
        DIVIDER,
        edit('format.clear', 'Clear formatting', clearFormatting),
      ],
    },

    {
      id: 'view',
      label: 'View',
      rows: [
        go('app.palette', 'Command palette', { asks: true }),
        DIVIDER,
        go('app.reading', 'Reading', {
          checked: !!workspace.active?.reading,
          disabled: workspace.active?.kind !== 'note',
        }),
        go('app.read-only', 'Read-only', { checked: modes.readOnly }),
        go('app.source', 'Source mode', { checked: modes.sourceIn(view) }),
        go('app.typewriter', 'Typewriter mode', { checked: modes.typewriter }),
        go('app.focus', 'Focus mode', { checked: modes.focus }),
        {
          label: 'Fullscreen',
          ...keyed('app.fullscreen'),
          checked: fullscreen.on,
          run: entry('app.fullscreen'),
        },
        ...unlessTouch([
          go('app.fill-tab', 'Full window', {
            checked: workspace.panes.fills !== null,
            disabled: workspace.panes.fills === null && !workspace.activeTabId,
          }),
        ]),
        ...(isDesktop
          ? [
              {
                label: 'Always on top',
                checked: modes.alwaysOnTop,
                run: () => modes.toggleAlwaysOnTop(),
              },
            ]
          : []),
        DIVIDER,
        ...unlessTouch([
          go('pane.split-right', 'Split right', { disabled: !workspace.canSplit('row') }),
          go('pane.split-down', 'Split down', { disabled: !workspace.canSplit('column') }),
          go('pane.focus-next', 'Other pane', { disabled: workspace.panes.count < 2 }),
          DIVIDER,
        ]),
        go('app.sidebar', 'Left sidebar', { checked: !!workspace.panel }),
        go('app.right-sidebar', 'Right sidebar', {
          checked: !!workspace.openOn('right'),
          disabled: !workspace.right.length,
        }),
        go('app.files', 'Files'),
        { label: 'Outline', run: () => workspace.showPanel('outline') },
        ...unlessTouch([go('app.ask', 'Ask')]),
        DIVIDER,
        fold('view.fold', 'Fold', toggleFold),
        fold('view.fold-all', 'Fold everything', foldHeadings),
        fold('view.fold-more', 'Fold more', foldMore),
        fold('view.fold-less', 'Fold less', foldLess),
        fold('view.unfold-all', 'Unfold everything', unfoldEverything),
        DIVIDER,
        go('app.zoom-in', 'Zoom in'),
        go('app.zoom-out', 'Zoom out'),
        go('app.zoom-reset', 'Actual size'),
      ],
    },

    {
      id: 'help',
      label: 'Help',
      rows: [
        {
          label: account.user ? 'Sign out' : 'Sign in',
          asks: !account.user,
          run: () =>
            account.user
              ? __EVEN_PLUGIN__
                ? void account.signOut('asked')
                : void account.leave()
              : (account.open = true),
        },
        DIVIDER,
        ...(isDesktop
          ? [{ label: 'Check for updates', asks: true, run: () => void updates.check() }]
          : []),
        ...(isNative
          ? []
          : [{ label: 'Download the app', run: () => void openExternal(DOWNLOAD_URL) }]),
        { label: 'What is new', run: () => void openExternal(RELEASES_URL) },
        { label: 'Report an issue', run: () => void openExternal(ISSUES_URL) },
        { label: 'Source code', run: () => void openExternal(SOURCE_URL) },
      ],
    },
  ]
}
