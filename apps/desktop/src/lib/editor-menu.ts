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
  isSpellWord,
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
import { account } from './account.svelte'
import { canTranscribe } from './ai/hears'
import { copySelection, copyText, cutSelection } from './clipboard'
import { copyPicture } from './copy-picture'
import { countText } from './counts'
import { linkTo } from './composer'
import { composerEntries } from './composer-commands'
import { t } from './i18n.svelte'
import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
import { modes } from './modes.svelte'
import { webHref } from './open-link'
import { recordingAt, transcribeEmbed } from './recorder/commands'
import { openExternal } from './tauri'
import { shortcuts } from './shortcuts.svelte'
import { isMarkdownPath, noteName, relativeTo } from './space-paths'
import { workspace } from './workspace.svelte'
import { viewport } from './viewport.svelte'

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
      return t('Heading')
    case 'paragraph':
      return t('Paragraph')
    case 'list':
      return t('List item')
    case 'quote':
      return t('Quote')
    case 'code':
      return t('Code block')
    case 'table':
      return t('Table')
    case 'math':
      return t('Equation')
    case 'properties':
      return t('Properties')
    case 'rule':
      return t('Horizontal rule')
    case 'block':
      return t('Block')
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
          ? t('{blocks} blocks, {count} words', { blocks: spans.length, count: words })
          : t('{kind}, {count} words', {
              kind: blockName(first?.kind ?? 'block'),
              count: words,
            }),
      disabled: true,
      run: () => undefined,
    },
    { label: t('Turn into'), run: () => void turnInto(view, at) },
    DIVIDER,
    { label: t('Indent'), run: () => indentBlocks(view, at) },
    { label: t('Outdent'), run: () => outdentBlocks(view, at) },
    { label: t('Move up'), run: () => moveBlocks(view, at, -1) },
    { label: t('Move down'), run: () => moveBlocks(view, at, 1) },
    ...calloutEntries(view),
    DIVIDER,
    { label: t('Duplicate'), run: () => duplicateBlocks(view, at) },
    {
      label: t('Copy link'),
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
    { label: t('Delete'), danger: true, run: () => deleteBlocks(view, at) },
    ...blockBookmark(view, at, path),
  ]
}

function calloutEntries(view: EditorView): MenuEntry[] {
  const sign = calloutSign(view.state)
  if (sign === null) return []

  return [
    DIVIDER,
    {
      label: t('Foldable'),
      checked: sign !== '',
      run: () => runCommand(view, setCalloutSign('+')),
    },
    {
      label: t('Starts folded'),
      checked: sign === '-',
      run: () => runCommand(view, setCalloutSign('-')),
    },
  ]
}

const SHAPES: readonly { shape: BlockShape; label: () => string }[] = [
  { shape: 'heading1', label: () => t('Heading {level}', { level: 1 }) },
  { shape: 'heading2', label: () => t('Heading {level}', { level: 2 }) },
  { shape: 'heading3', label: () => t('Heading {level}', { level: 3 }) },
  { shape: 'paragraph', label: () => t('Paragraph') },
  { shape: 'bullet', label: () => t('Bulleted list') },
  { shape: 'numbered', label: () => t('Numbered list') },
  { shape: 'task', label: () => t('Task list') },
  { shape: 'quote', label: () => t('Quote') },
]

async function turnInto(view: EditorView, at: number) {
  const { prompt } = await import('./prompt.svelte')
  const chosen = await prompt.find({
    title: t('Turn into'),
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
      ? { label: t('Remove from Essentials'), run: () => workspace.bookmarks.toggle(held) }
      : {
          label: spans.length > 1 ? t('Add blocks to Essentials') : t('Add block to Essentials'),
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
  if (__EVEN_PLUGIN__ || !note || !account.accountToken) return []
  const run = () => {
    const range = view.state.selection.main
    void import('./chats/send').then(({ sendSelection }) =>
      sendSelection(note, view.state.doc.toString(), range.from, range.to),
    )
  }
  return [{ label: t('Send to chat'), run }]
}

function editorMenu(view: EditorView | undefined, block: MenuEntry[]): MenuEntry[] {
  const selected = !!view && !view.state.selection.main.empty
  const locked = !!view && view.state.readOnly
  const run = (command: StateCommand) => () => runCommand(view, command)

  const clipboard: MenuEntry[] = [
    {
      label: t('Cut'),
      hint: shortcuts.hint('fixed.cut'),
      disabled: !selected || locked,
      run: cutSelection,
    },
    {
      label: t('Copy'),
      hint: shortcuts.hint('fixed.copy'),
      disabled: !selected,
      run: copySelection,
    },
    {
      label: t('Paste'),
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
        label: t('Leave read-only'),
        hint: shortcuts.hint('app.read-only'),
        run: () => modes.toggleReadOnly(view),
      },
    ]
  }

  return [
    ...clipboard,
    ...block,
    ...(selected
      ? [DIVIDER, { label: t('Rewrite…'), run: () => void rewrite(view) }, ...sendEntry(view)]
      : []),
    DIVIDER,
    { label: t('Bold'), hint: shortcuts.hint('format.bold'), run: run(toggleWrap('**')) },
    { label: t('Italic'), hint: shortcuts.hint('format.italic'), run: run(toggleWrap('*')) },
    { label: t('Code'), hint: shortcuts.hint('format.code'), run: run(toggleWrap('`')) },
    { label: t('Link'), hint: shortcuts.hint('format.link'), run: run(insertLink) },
    {
      label: t('Clear formatting'),
      hint: shortcuts.hint('format.clear'),
      run: run(clearFormatting),
    },
    DIVIDER,
    { label: t('Quote'), hint: shortcuts.hint('paragraph.quote'), run: run(toggleQuote) },
    {
      label: t('Bulleted list'),
      hint: shortcuts.hint('paragraph.bullet-list'),
      run: run(toggleBulletList),
    },
    {
      label: t('Numbered list'),
      hint: shortcuts.hint('paragraph.ordered-list'),
      run: run(toggleOrderedList),
    },
    {
      label: t('Table'),
      hint: shortcuts.hint('paragraph.table'),
      run: () => {
        if (view) insertTableToEdit(view)
      },
    },
    {
      label: t('Code block'),
      hint: shortcuts.hint('paragraph.code-block'),
      run: run(insertCodeFence),
    },
    {
      label: t('Horizontal rule'),
      hint: shortcuts.hint('paragraph.rule'),
      run: run(insertHorizontalRule),
    },
    { label: t('Page break'), run: run(insertPageBreak) },
    DIVIDER,
    ...composerEntries(view),
    DIVIDER,
    {
      label: modes.sourceIn(view) ? t('Leave source mode') : t('Source mode'),
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
  ]
}

function wordUnder(view: EditorView, event: MouseEvent): string | null {
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (at === null) return null

  const range = view.state.wordAt(at)
  if (!range) return null

  const word = view.state.doc.sliceString(range.from, range.to)
  return isSpellWord(word) ? word : null
}

function spellingEntries(view: EditorView | undefined, event: MouseEvent): MenuEntry[] {
  if (!view || !modes.spellcheck) return []

  const on = event.target
  if (on instanceof Element && on.closest('.nib-block-handle')) return []

  const word = wordUnder(view, event)
  if (word === null) return []

  const known = modes.knowsWord(word)
  return [
    DIVIDER,
    {
      label: known
        ? t('Remove {word} from the dictionary', { word })
        : t('Add {word} to the dictionary', { word }),
      run: () => modes.toggleSpellWord(word, view),
    },
  ]
}

function recordingEntries(view: EditorView | undefined, at: number | null): MenuEntry[] {
  if (!view || at === null || view.state.readOnly || !canTranscribe()) return []
  if (!recordingAt(view, at)) return []

  return [DIVIDER, { label: t('Transcribe'), run: () => void transcribeEmbed(view, at) }]
}

function linkEntries(
  view: EditorView | undefined,
  event: MouseEvent,
  path: string | null | undefined,
): MenuEntry[] {
  const target = event.target
  const link = target instanceof Element ? target.closest('.nib-link') : null
  if (!link) return []

  const href = link.getAttribute('data-href')
  const at = view?.contentDOM.contains(link) ? view.posAtDOM(link) : null
  const parts = view && at !== null && !view.state.readOnly ? linkPartsAt(view.state, at) : null
  const jump = view && at !== null && link.hasAttribute('data-note') ? jumpAt(view.state, at) : null

  return [
    ...(jump ? noteEntries(jump, path ?? null) : []),
    ...(href && webHref(href) !== null
      ? [{ label: t('Open in the browser'), run: () => void openExternal(href) }]
      : []),
    ...(href ? [{ label: t('Copy link address'), run: () => void copyText(href) }] : []),
    ...(view && parts
      ? [
          { label: t('Edit link'), run: () => runCommand(view, editLink(parts.from)) },
          ...(parts.words === null
            ? []
            : [{ label: t('Remove link'), run: () => runCommand(view, removeLink(parts.from)) }]),
        ]
      : []),
    DIVIDER,
  ]
}

function noteEntries(jump: NoteJump, from: string | null): MenuEntry[] {
  return [
    { label: t('Open in new tab'), run: () => void workspace.followLink(jump, 'behind', from) },
    ...(viewport.touch
      ? []
      : [
          {
            label: t('Open to the side'),
            run: () => void workspace.followLink(jump, 'aside', from),
          },
        ]),
    { label: t('Copy link'), run: () => void copyText(linkOf(jump)) },
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
      label: t('Copy picture'),
      run: () => void copyPicture(pictureUrl(view.state, picture)).catch(() => undefined),
    },
    { label: t('Open picture'), run: () => showPicture(view, picture) },
    ...(view.state.readOnly
      ? []
      : [
          {
            label: t('Delete picture'),
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
      ...spellingEntries(view, event),
    ],
    { near: true },
  )
}
