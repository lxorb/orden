import {
  type BlockKind,
  type BlockShape,
  clearFormatting,
  type EditorView,
  type NoteJump,
  insertCodeFence,
  insertHorizontalRule,
  insertLink,
  insertPageBreak,
  calloutSign,
  insertTableToEdit,
  type StateCommand,
  toggleBulletList,
  toggleOrderedList,
  setCalloutSign,
  toggleQuote,
  toggleWrap,
  type Transaction,
} from '@orden/editor'
import {
  blocksFor,
  blockTargets,
  deleteBlocks,
  deletePicture,
  duplicateBlocks,
  editLink,
  indentBlocks,
  jumpAt,
  linkPartsAt,
  moveBlocks,
  outdentBlocks,
  pictureUrl,
  pressedPicture,
  removeLink,
  showPicture,
  turnBlocksInto,
} from '@orden/editor/menu'
import { account } from './accounts/src/api'
import { chatsOn } from './settings.svelte'
import { canTranscribe } from './ai-providers/src/api'
import { copySelection, copyText, cutSelection } from './ui-controls/src/api'
import { copyPicture } from './copy-picture'
import { countText } from './counts'
import { linkTo } from './composer'
import { composerEntries } from './composer-commands'
import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
import { modes } from './modes.svelte'
import { webHref } from './open-link'
import { recordingAt, transcribeEmbed } from './dictation/src/api'
import { openExternal, isMarkdownPath, noteName, relativeTo } from './platform/src/api'
import { shortcuts } from './shortcuts.svelte'
import { workspace } from './workspace.svelte'
import { unlocks } from './protect/src/api'
import { viewport } from './ui-kit/src/api'

function runCommand(view: EditorView | undefined, command: StateCommand) {
  if (!view) return

  command({ state: view.state, dispatch: (transaction: Transaction) => view.dispatch(transaction) })
  view.focus()
}

async function paste(view: EditorView) {
  const text = await navigator.clipboard.readText().catch(() => '')
  if (!text) return

  const range = view.state.selection.main
  view.dispatch({ changes: { from: range.from, to: range.to, insert: text } })
  view.focus()
}

function blockName(kind: BlockKind): string {
  switch (kind) {
    case 'heading':
      return 'Heading'
    case 'paragraph':
      return 'Paragraph'
    case 'list':
      return 'List item'
    case 'quote':
      return 'Quote'
    case 'code':
      return 'Code block'
    case 'table':
      return 'Table'
    case 'math':
      return 'Equation'
    case 'front-matter':
      return 'Front matter'
    case 'rule':
      return 'Horizontal rule'
    case 'block':
      return 'Block'
  }
}

export function blockLinkName(path: string | null | undefined): string | null {
  return path && isMarkdownPath(path) ? noteName(path) : null
}

function blockEntries(
  view: EditorView | undefined,
  at: number | null,
  path: string | null | undefined,
): MenuEntry[] {
  if (!view || at === null || view.state.readOnly) return []

  const spans = blocksFor(view, at)
  if (!spans.length) return []

  const words = countText(
    spans.map((span) => view.state.doc.sliceString(span.from, span.to)).join('\n'),
  ).words
  const name = blockLinkName(path)
  const first = spans[0]

  return [
    DIVIDER,
    {
      label:
        spans.length > 1
          ? `${spans.length} blocks, ${words} words`
          : `${blockName(first?.kind ?? 'block')}, ${words} words`,
      disabled: true,
      run: () => undefined,
    },
    { label: 'Turn into', run: () => void turnInto(view, at) },
    DIVIDER,
    { label: 'Indent', run: () => indentBlocks(view, at) },
    { label: 'Outdent', run: () => outdentBlocks(view, at) },
    { label: 'Move up', run: () => moveBlocks(view, at, -1) },
    { label: 'Move down', run: () => moveBlocks(view, at, 1) },
    ...calloutEntries(view),
    DIVIDER,
    { label: 'Duplicate', run: () => duplicateBlocks(view, at) },
    {
      label: 'Copy link',
      disabled: !name,
      run: () => {
        const targets = name ? blockTargets(view, at) : []
        if (!name || !targets.length) return

        const root = path ? workspace.rootHolding(path) : null
        const relative = root !== null && path?.startsWith(root) ? relativeTo(root, path) : null
        void copyText(
          targets
            .map((target) =>
              linkTo(name, null, {
                fragment: target.slice(1),
                ...(relative ? { path: relative, from: relative } : {}),
              }),
            )
            .join('\n'),
        )
      },
    },
    { label: 'Delete', danger: true, run: () => deleteBlocks(view, at) },
    ...blockBookmark(view, at, path),
  ]
}

function calloutEntries(view: EditorView): MenuEntry[] {
  const sign = calloutSign(view.state)
  if (sign === null) return []

  return [
    DIVIDER,
    {
      label: 'Foldable',
      checked: sign !== '',
      run: () => runCommand(view, setCalloutSign('+')),
    },
    {
      label: 'Starts folded',
      checked: sign === '-',
      run: () => runCommand(view, setCalloutSign('-')),
    },
  ]
}

const SHAPES: readonly { shape: BlockShape; label: () => string }[] = [
  { shape: 'heading1', label: () => 'Heading 1' },
  { shape: 'heading2', label: () => 'Heading 2' },
  { shape: 'heading3', label: () => 'Heading 3' },
  { shape: 'paragraph', label: () => 'Paragraph' },
  { shape: 'bullet', label: () => 'Bulleted list' },
  { shape: 'numbered', label: () => 'Numbered list' },
  { shape: 'task', label: () => 'Task list' },
  { shape: 'quote', label: () => 'Quote' },
]

async function turnInto(view: EditorView, at: number) {
  const { prompt } = await import('./ui-kit/src/api')
  const chosen = await prompt.find({
    title: 'Turn into',
    options: SHAPES.map((one) => ({ id: one.shape, label: one.label() })),
  })

  const shape = SHAPES.find((one) => one.shape === chosen)
  if (shape) turnBlocksInto(view, at, shape.shape)
}

function firstWords(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>|`{3,}|~{3,})\s*/, '')
    .trim()
    .slice(0, 60)
}

function blockBookmark(view: EditorView, at: number, path: string | null | undefined): MenuEntry[] {
  const root = workspace.activeSpace?.root
  if (!path || root === undefined || !path.startsWith(root)) return []

  const relative = relativeTo(root, path)
  const spans = blocksFor(view, at)
  const span = spans[0]
  if (!span) return []

  const words = firstWords(view.state.doc.sliceString(span.from, span.to))
  const held = workspace.bookmarks.list.find(
    (one) => one.kind === 'block' && one.path.startsWith(`${relative}#`) && one.text === words,
  )

  return [
    held
      ? { label: 'Remove from Essentials', run: () => workspace.bookmarks.toggle(held) }
      : {
          label: spans.length > 1 ? 'Add blocks to Essentials' : 'Add block to Essentials',
          run: () => {
            const said = blocksFor(view, at).map((one) =>
              firstWords(view.state.doc.sliceString(one.from, one.to)),
            )

            for (const [index, target] of blockTargets(view, at).entries()) {
              const mark = workspace.bookmarks.forBlock(relative, target, said[index] ?? words)
              if (mark) workspace.bookmarks.toggle(mark)
            }
          },
        },
  ]
}

async function rewrite(view: EditorView) {
  const { rewriting } = await import('./ai/rewriting.svelte')
  rewriting.show(view)
}

function sendEntry(view: EditorView): MenuEntry[] {
  const tab = workspace.active
  const note = tab?.kind === 'note' ? tab.path : null
  if (__EVEN_PLUGIN__ || !note || !account.accountToken || !chatsOn()) return []
  const run = () => {
    const range = view.state.selection.main
    void import('./chats-client/src/api')
      .then((one) => one.chatSending())
      .then(({ sendSelection }) =>
        sendSelection(note, view.state.doc.toString(), range.from, range.to),
      )
  }
  return [{ label: 'Send to chat', run }]
}

function editorMenu(view: EditorView | undefined, block: MenuEntry[]): MenuEntry[] {
  const selected = !!view && !view.state.selection.main.empty
  const locked = !!view && view.state.readOnly
  const run = (command: StateCommand) => () => runCommand(view, command)

  const clipboard: MenuEntry[] = [
    {
      label: 'Cut',
      hint: shortcuts.hint('fixed.cut'),
      disabled: !selected || locked,
      run: cutSelection,
    },
    {
      label: 'Copy',
      hint: shortcuts.hint('fixed.copy'),
      disabled: !selected,
      run: copySelection,
    },
    {
      label: 'Paste',
      hint: shortcuts.hint('fixed.paste'),
      disabled: locked,
      run: () => {
        if (view) void paste(view)
      },
    },
  ]

  if (viewport.touch) return [...clipboard, ...block]

  if (locked) {
    return [
      ...clipboard,
      DIVIDER,
      {
        label: 'Leave read-only',
        hint: shortcuts.hint('app.read-only'),
        run: () => modes.toggleReadOnly(view),
      },
    ]
  }

  return [
    ...clipboard,
    ...block,
    ...(selected
      ? [DIVIDER, { label: 'Rewrite…', run: () => void rewrite(view) }, ...sendEntry(view)]
      : []),
    DIVIDER,
    { label: 'Bold', hint: shortcuts.hint('format.bold'), run: run(toggleWrap('**')) },
    { label: 'Italic', hint: shortcuts.hint('format.italic'), run: run(toggleWrap('*')) },
    { label: 'Code', hint: shortcuts.hint('format.code'), run: run(toggleWrap('`')) },
    { label: 'Link', hint: shortcuts.hint('format.link'), run: run(insertLink) },
    {
      label: 'Clear formatting',
      hint: shortcuts.hint('format.clear'),
      run: run(clearFormatting),
    },
    DIVIDER,
    { label: 'Quote', hint: shortcuts.hint('paragraph.quote'), run: run(toggleQuote) },
    {
      label: 'Bulleted list',
      hint: shortcuts.hint('paragraph.bullet-list'),
      run: run(toggleBulletList),
    },
    {
      label: 'Numbered list',
      hint: shortcuts.hint('paragraph.ordered-list'),
      run: run(toggleOrderedList),
    },
    {
      label: 'Table',
      hint: shortcuts.hint('paragraph.table'),
      run: () => {
        if (view) insertTableToEdit(view)
      },
    },
    {
      label: 'Code block',
      hint: shortcuts.hint('paragraph.code-block'),
      run: run(insertCodeFence),
    },
    {
      label: 'Horizontal rule',
      hint: shortcuts.hint('paragraph.rule'),
      run: run(insertHorizontalRule),
    },
    { label: 'Page break', run: run(insertPageBreak) },
    DIVIDER,
    ...composerEntries(view),
    DIVIDER,
    {
      label: modes.sourceIn(view) ? 'Leave source mode' : 'Source mode',
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
  ]
}

function recordingEntries(view: EditorView | undefined, at: number | null): MenuEntry[] {
  if (!view || at === null || view.state.readOnly || !canTranscribe()) return []
  if (!recordingAt(view, at)) return []

  return [DIVIDER, { label: 'Transcribe', run: () => void transcribeEmbed(view, at) }]
}

function linkEntries(
  view: EditorView | undefined,
  event: MouseEvent,
  path: string | null | undefined,
): MenuEntry[] {
  const target = event.target
  const link = target instanceof Element ? target.closest('.orden-link') : null
  if (!link) return []

  const href = link.getAttribute('data-href')
  const at = view?.contentDOM.contains(link) ? view.posAtDOM(link) : null
  const parts = view && at !== null && !view.state.readOnly ? linkPartsAt(view.state, at) : null
  const jump = view && at !== null && link.hasAttribute('data-note') ? jumpAt(view.state, at) : null

  return [
    ...(jump ? noteEntries(jump, path ?? null) : []),
    ...(href && webHref(href) !== null
      ? [{ label: 'Open in the browser', run: () => void openExternal(href) }]
      : []),
    ...(href ? [{ label: 'Copy link address', run: () => void copyText(href) }] : []),
    ...(view && parts
      ? [
          { label: 'Edit link', run: () => runCommand(view, editLink(parts.from)) },
          ...(parts.words === null
            ? []
            : [{ label: 'Remove link', run: () => runCommand(view, removeLink(parts.from)) }]),
        ]
      : []),
    DIVIDER,
  ]
}

function noteEntries(jump: NoteJump, from: string | null): MenuEntry[] {
  return [
    { label: 'Open in new tab', run: () => void workspace.followLink(jump, 'behind', from) },
    ...(viewport.touch
      ? []
      : [
          {
            label: 'Open to the side',
            run: () => void workspace.followLink(jump, 'aside', from),
          },
        ]),
    { label: 'Copy link', run: () => void copyText(linkOf(jump)) },
  ]
}

function linkOf(jump: NoteJump): string {
  const fragment =
    jump.block !== null
      ? `^${jump.block}`
      : (jump.heading ?? (jump.page === null ? null : `page=${String(jump.page)}`))

  return linkTo(jump.path ? noteName(jump.path) : jump.target, null, {
    path: jump.path,
    fragment,
  })
}

function pictureEntries(view: EditorView | undefined, event: MouseEvent): MenuEntry[] {
  const picture = view ? pressedPicture(view, event.target) : null
  if (!view || !picture) return []

  return [
    {
      label: 'Copy picture',
      run: () => void copyPicture(pictureUrl(view.state, picture)).catch(() => undefined),
    },
    { label: 'Open picture', run: () => showPicture(view, picture) },
    ...(view.state.readOnly
      ? []
      : [
          {
            label: 'Delete picture',
            danger: true,
            run: () => runCommand(view, deletePicture(picture)),
          },
        ]),
    DIVIDER,
  ]
}

export function showEditorMenu(
  event: MouseEvent,
  view: EditorView | undefined,
  path?: string | null,
) {
  const at = view ? view.posAtCoords({ x: event.clientX, y: event.clientY }, false) : null

  menu.show(
    event,
    [
      ...pictureEntries(view, event),
      ...linkEntries(view, event, path),
      ...editorMenu(view, blockEntries(view, at, path)),
      ...recordingEntries(view, at),
    ],
    { near: true, until: unlocks.held },
  )
}
