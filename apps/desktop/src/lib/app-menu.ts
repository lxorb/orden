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
import { HIGHLIGHT_COLOURS } from '@orden/markdown/highlights'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { copySelection, cutSelection } from './clipboard'
import { blockCommands, exportCommands } from './commands'
import { fullscreen } from './fullscreen.svelte'
import { EXPORT_FORMATS, EXPORT_VARIANTS } from './export/formats'
import { EXPORT_EXTRAS } from './export/offer'
import { canPrint, printable, printOpen } from './export/print'
import { t } from './i18n.svelte'
import { DIVIDER, type MenuGroup, type MenuItem, type MenuRow } from './menu-item'
import { modes } from './modes.svelte'
import { shortcuts } from './shortcuts.svelte'
import { toggleFill } from './tab-fill/fill'
import { present } from './slides/present.svelte'
import { DOWNLOAD_URL, ISSUES_URL, RELEASES_URL, SOURCE_URL } from './links'
import { isDesktop, isNative, openExternal } from './tauri'
import { updates } from './updates.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

interface Context {
  view?: EditorView | undefined
  onpalette(): void
  onhistory(): void
}

function exportRows(): MenuRow[] {
  const formats = new Set<string>(
    [...EXPORT_FORMATS, ...EXPORT_EXTRAS].map((one) => `export-${one.id}`),
  )
  const variants = new Set<string>(EXPORT_VARIANTS.map((one) => `export-${one.id}`))

  const rows: MenuRow[] = []
  let last: string | null = null

  for (const command of exportCommands()) {
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
  const hasNote = !!workspace.active
  const selected = !!view && !view.state.selection.main.empty
  const writable = !!view && !view.state.readOnly

  const edit = (id: string, label: string, command: StateCommand): MenuItem => ({
    label,
    ...keyed(id),
    disabled: !writable,
    run: () => run(view, command),
  })

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
      label: t('File'),
      rows: [
        { label: t('Export'), rows: exportRows() },
        ...(canPrint
          ? [
              {
                label: t('Print'),
                ...keyed('app.print'),
                asks: true,
                disabled: !printable(workspace.active?.kind),
                run: () => busy.start(t('Printing'), () => printOpen(), 'print'),
              },
            ]
          : []),
        DIVIDER,
        {
          label: t('Version history'),
          asks: true,
          disabled: !hasNote,
          run: () => context.onhistory(),
        },
      ],
    },

    {
      id: 'edit',
      label: t('Edit'),
      rows: [
        {
          label: t('Undo'),
          ...keyed('edit.undo'),
          disabled: !writable,
          run: () => view && undoEdit(view),
        },
        {
          label: t('Redo'),
          ...keyed('edit.redo'),
          disabled: !writable,
          run: () => view && redoEdit(view),
        },
        DIVIDER,
        {
          label: t('Cut'),
          ...keyed('fixed.cut'),
          disabled: !selected || !writable,
          run: cutSelection,
        },
        {
          label: t('Copy'),
          ...keyed('fixed.copy'),
          disabled: !selected,
          run: copySelection,
        },
        {
          label: t('Paste'),
          ...keyed('fixed.paste'),
          disabled: !writable,
          run: onView(pasteHere),
        },
        {
          label: t('Paste as plain text'),
          ...keyed('edit.paste-plain'),
          disabled: !writable,
          run: onView(pastePlain),
        },
        DIVIDER,
        {
          label: t('Select all'),
          ...keyed('edit.select-all'),
          disabled: !view,
          run: () => view?.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
        },
        DIVIDER,
        {
          label: t('Find'),
          ...keyed('edit.find'),
          asks: true,
          disabled: !view,
          run: onView(openFind),
        },
        {
          label: t('Replace'),
          ...keyed('edit.replace'),
          asks: true,
          disabled: !writable,
          run: onView(openReplace),
        },
        ...(viewport.touch
          ? []
          : [
              {
                label: t('Find next'),
                ...keyed('edit.find-next'),
                disabled: !view,
                run: onView(findNext),
              },
              {
                label: t('Find previous'),
                ...keyed('edit.find-previous'),
                disabled: !view,
                run: onView(findPrevious),
              },
            ]),
        {
          label: t('Search'),
          ...keyed('app.search'),
          run: () => workspace.showPanel('search'),
        },
      ],
    },

    {
      id: 'paragraph',
      label: t('Paragraph'),
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
        ...blocks('paragraph.rule', 'slide-break', 'page-break'),
      ],
    },

    {
      id: 'format',
      label: t('Format'),
      rows: [
        {
          label: t('Bold'),
          ...keyed('format.bold'),
          disabled: !writable,
          run: () => run(view, toggleWrap('**')),
        },
        {
          label: t('Italic'),
          ...keyed('format.italic'),
          disabled: !writable,
          run: () => run(view, toggleWrap('*')),
        },
        {
          label: t('Strikethrough'),
          ...keyed('format.strikethrough'),
          disabled: !writable,
          run: () => run(view, toggleWrap('~~')),
        },
        {
          label: t('Highlight'),
          ...keyed('format.highlight'),
          disabled: !writable,
          run: () => run(view, highlightSelection),
        },
        {
          label: t('Highlight colour'),
          disabled: !writable,
          rows: HIGHLIGHT_COLOURS.map((colour) => ({
            label: t(colour.name),
            checked: colour.tone === modes.highlightTone,
            run: () => {
              modes.setHighlightTone(colour.tone)
              run(view, toggleHighlight(colour))
            },
          })),
        },
        DIVIDER,
        {
          label: t('Code'),
          ...keyed('format.code'),
          disabled: !writable,
          run: () => run(view, toggleWrap('`')),
        },
        { label: t('Inline math'), disabled: !writable, run: () => run(view, toggleWrap('$')) },
        { label: t('Superscript'), disabled: !writable, run: () => run(view, toggleWrap('^')) },
        { label: t('Subscript'), disabled: !writable, run: () => run(view, toggleWrap('~')) },
        DIVIDER,
        {
          label: t('Link'),
          ...keyed('format.link'),
          disabled: !writable,
          run: () => run(view, insertLink),
        },
        edit('format.comment', t('Comment'), insertComment),
        DIVIDER,
        {
          label: t('Clear formatting'),
          ...keyed('format.clear'),
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
          ...keyed('app.palette'),
          asks: true,
          run: () => context.onpalette(),
        },
        DIVIDER,
        {
          label: t('Reading'),
          ...keyed('app.reading'),
          checked: !!workspace.active?.reading,
          disabled: workspace.active?.kind !== 'note',
          run: () => workspace.toggleReading(),
        },
        {
          label: t('Present'),
          ...keyed('app.present'),
          checked: present.on,
          disabled: !present.on && !present.available,
          run: () => present.toggle(),
        },
        {
          label: t('Read-only'),
          ...keyed('app.read-only'),
          checked: modes.readOnly,
          run: () => modes.toggleReadOnly(view),
        },
        {
          label: t('Source mode'),
          ...keyed('app.source'),
          checked: modes.sourceIn(view),
          run: () => modes.toggleSource(view),
        },
        {
          label: t('Typewriter mode'),
          ...keyed('app.typewriter'),
          checked: modes.typewriter,
          run: () => modes.toggleTypewriter(view),
        },
        {
          label: t('Focus mode'),
          ...keyed('app.focus'),
          checked: modes.focus,
          run: () => modes.toggleFocus(view),
        },
        {
          label: t('Fullscreen'),
          ...keyed('app.fullscreen'),
          checked: fullscreen.on,
          run: () => void fullscreen.toggle(workspace.panes),
        },
        ...(viewport.touch
          ? []
          : [
              {
                label: t('Full window'),
                ...keyed('app.fill-tab'),
                checked: workspace.panes.fills !== null,
                disabled: workspace.panes.fills === null && !workspace.activeTabId,
                run: () => void toggleFill(),
              },
            ]),
        ...(isDesktop
          ? [
              {
                label: t('Always on top'),
                checked: modes.alwaysOnTop,
                run: () => modes.toggleAlwaysOnTop(),
              },
            ]
          : []),
        DIVIDER,
        ...(viewport.touch
          ? []
          : [
              {
                label: t('Split right'),
                ...keyed('pane.split-right'),
                disabled: !workspace.canSplit('row'),
                run: () => workspace.split('row'),
              },
              {
                label: t('Split down'),
                ...keyed('pane.split-down'),
                disabled: !workspace.canSplit('column'),
                run: () => workspace.split('column'),
              },
              {
                label: t('Other pane'),
                ...keyed('pane.focus-next'),
                disabled: workspace.panes.count < 2,
                run: () => workspace.panes.focusNext(),
              },
              DIVIDER,
            ]),
        {
          label: t('Left sidebar'),
          ...keyed('app.sidebar'),
          checked: !!workspace.panel,
          run: () => workspace.toggleSidebar(),
        },
        {
          label: t('Right sidebar'),
          ...keyed('app.right-sidebar'),
          checked: !!workspace.openOn('right'),
          disabled: !workspace.right.length,
          run: () => workspace.toggleSidebar('right'),
        },
        {
          label: t('Files'),
          ...keyed('app.files'),
          run: () => workspace.showPanel('tree'),
        },
        { label: t('Outline'), run: () => workspace.showPanel('outline') },
        ...(viewport.touch
          ? []
          : [{ label: t('Ask'), ...keyed('app.ask'), run: () => workspace.showPanel('ask') }]),
        DIVIDER,
        { label: t('Fold'), ...keyed('view.fold'), run: () => run(view, toggleFold) },
        {
          label: t('Fold everything'),
          ...keyed('view.fold-all'),
          run: () => run(view, foldHeadings),
        },
        {
          label: t('Fold more'),
          ...keyed('view.fold-more'),
          run: () => run(view, foldMore),
        },
        {
          label: t('Fold less'),
          ...keyed('view.fold-less'),
          run: () => run(view, foldLess),
        },
        {
          label: t('Unfold everything'),
          ...keyed('view.unfold-all'),
          run: () => run(view, unfoldEverything),
        },
        DIVIDER,
        {
          label: t('Zoom in'),
          ...keyed('app.zoom-in'),
          run: () => workspace.zoomPage('in') || modes.stepZoom(1),
        },
        {
          label: t('Zoom out'),
          ...keyed('app.zoom-out'),
          run: () => workspace.zoomPage('out') || modes.stepZoom(-1),
        },
        {
          label: t('Actual size'),
          ...keyed('app.zoom-reset'),
          run: () => workspace.zoomPage('reset') || modes.resetZoom(),
        },
      ],
    },

    {
      id: 'help',
      label: t('Help'),
      rows: [
        {
          label: account.user ? t('Sign out') : t('Sign in'),
          asks: !account.user,
          run: () =>
            account.user
              ? __EVEN_PLUGIN__
                ? void account.signOut('asked')
                : void import('./ai/vault/leaving').then((one) => one.signOut())
              : (account.open = true),
        },
        DIVIDER,
        ...(isDesktop
          ? [{ label: t('Check for updates'), asks: true, run: () => void updates.check() }]
          : []),
        ...(isNative
          ? []
          : [{ label: t('Download the app'), run: () => void openExternal(DOWNLOAD_URL) }]),
        { label: t('What is new'), run: () => void openExternal(RELEASES_URL) },
        { label: t('Report an issue'), run: () => void openExternal(ISSUES_URL) },
        { label: t('Source code'), run: () => void openExternal(SOURCE_URL) },
      ],
    },
  ]
}
