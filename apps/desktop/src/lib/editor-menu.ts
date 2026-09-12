import {
  type BlockKind,
  blocksFor,
  blockTarget,
  clearFormatting,
  deleteBlocks,
  duplicateBlocks,
  type EditorView,
  insertCodeFence,
  insertHorizontalRule,
  insertLink,
  insertPageBreak,
  insertTableToEdit,
  isSpellWord,
  type StateCommand,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleWrap,
  type Transaction,
} from '@nib/editor'
import { rewriting } from './ai/rewriting.svelte'
import { copySelection, copyText, cutSelection } from './clipboard'
import { countText } from './counts'
import { linkTo } from './composer'
import { composerEntries } from './composer-commands'
import { t } from './i18n.svelte'
import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
import { modes } from './modes.svelte'
import { shortcuts } from './shortcuts.svelte'
import { noteName, relativeTo } from './space-paths'
import { workspace } from './workspace.svelte'
import { viewport } from './viewport.svelte'

/** The editor's own context menu, so the browser's never appears.
 *
 *  Everything here calls the same commands the keyboard and the app menu call;
 *  what differs is how much of it is offered. A phone gets the clipboard alone,
 *  and a locked note gets the clipboard plus the way back out - a menu of things
 *  that cannot happen is worse than a short one. */

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

/** What a block is called, in the reader's own language. The editor answers with
 *  a word of its own and never with one anybody reads; this is where that word
 *  becomes one. */
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

/** The rows about the block a press landed in: what it is, and what can be done
 *  to it.
 *
 *  To it, or to every block a selection covers: a selection in nib is a selection
 *  of text and never a mode, so the blocks it lies across are simply the blocks it
 *  lies across. The first row is not a row to press - it says which block the rest
 *  of them are about, and how much of the note that is, which is the only place
 *  the app counts anything smaller than a note.
 *
 *  Nothing at all in a note nobody can write in: all three of these write, and a
 *  row that cannot happen is worse than no row. */
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
  const name = path ? noteName(path) : null
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
    { label: t('Duplicate'), run: () => duplicateBlocks(view, at) },
    {
      // A link to a block needs the block to have a name, and giving it one is a
      // change to the note; see blockTarget in @nib/editor. A note nobody has
      // saved yet has no path and so nothing to point at: the row is there and
      // says it cannot happen, which is shorter than explaining why.
      label: t('Copy link'),
      disabled: !name,
      run: () => {
        const target = name ? blockTarget(view, at) : null
        if (!name || !target) return

        // Through `linkTo` like every other link the app writes, so a space set
        // to markdown links gets one here too; see composer.ts. The block's own
        // path and the note it is written from are both this note, which is what
        // makes a relative link to it the bare file name.
        const root = workspace.activeSpace?.root
        const relative =
          root !== undefined && path?.startsWith(root) ? relativeTo(root, path) : null
        void copyText(
          linkTo(name, null, {
            fragment: target.slice(1),
            ...(relative ? { path: relative, from: relative } : {}),
          }),
        )
      },
    },
    { label: t('Delete'), danger: true, run: () => deleteBlocks(view, at) },
    ...blockBookmark(view, at, path),
  ]
}

/** The first words of a block, which is what a list of them can be read by: the
 *  line it opens with, without the markup that opens it. A name of the block's
 *  own is what `^a1b2c3` is not. */
function firstWords(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>|`{3,}|~{3,})\s*/, '')
    .trim()
    .slice(0, 60)
}

/** Keeping this block in the bookmarks above the file list.
 *
 *  The same naming a link to it uses - a heading by its words, anything else by a
 *  name written into the note; see blockTarget in @nib/editor - so the row and
 *  the link point at the same thing and neither has a way of its own. */
function blockBookmark(view: EditorView, at: number, path: string | null | undefined): MenuEntry[] {
  const root = workspace.activeSpace?.root
  if (!path || root === undefined || !path.startsWith(root)) return []

  const relative = relativeTo(root, path)
  const span = blocksFor(view, at)[0]
  if (!span) return []

  const words = firstWords(view.state.doc.sliceString(span.from, span.to))
  const held = workspace.bookmarks.list.find(
    (one) => one.kind === 'block' && one.path.startsWith(`${relative}#`) && one.text === words,
  )

  return [
    held
      ? { label: t('Remove bookmark'), run: () => workspace.bookmarks.toggle(held) }
      : {
          label: t('Bookmark this block'),
          run: () => {
            const target = blockTarget(view, at)
            const mark = target ? workspace.bookmarks.forBlock(relative, target, words) : null
            if (mark) workspace.bookmarks.toggle(mark)
          },
        },
  ]
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

  // On a phone a press on the text is for the clipboard, the way it is in
  // every other app there. The formatting lives in the bar above the
  // keyboard and in the app menu, and sixteen rows would cover the text
  // they are about.
  if (viewport.touch) return [...clipboard, ...block]

  // A locked note leaves the clipboard rows and the way back out. The rest of
  // this menu writes.
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
    // One row for the four rewrites, on a selection and only on one: what they do is
    // replace what is selected, and four rows here would be four rows greyed out in
    // every menu opened anywhere else. See ai/rewriting.svelte.ts.
    ...(selected
      ? [
          DIVIDER,
          // `selected` is what says there is a view: it is false without one, which
          // is why nothing here has to ask again.
          { label: t('Rewrite…'), run: () => rewriting.show(view) },
        ]
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
    // Not through `run`: the new table takes the focus into its first cell,
    // and focusing the editor afterwards would take it straight back out.
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
    // Moving text between notes. Here rather than only in the palette because
    // what they act on is the caret and the selection, which is what a right
    // click is already about.
    ...composerEntries(view),
    DIVIDER,
    {
      label: modes.source ? t('Leave source mode') : t('Source mode'),
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
  ]
}

/** The word a right click landed on, or null where it landed on none.
 *
 *  This is as close as a page can get to "the misspelled word": no browser will
 *  say which words its checker thinks are wrong, on any platform. It does not
 *  need to - the wavy line is under the word, the pointer is on the word, and
 *  the word is what the reader means. See spelling.ts in the editor package. */
function wordUnder(view: EditorView, event: MouseEvent): string | null {
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (at === null) return null

  const range = view.state.wordAt(at)
  if (!range) return null

  const word = view.state.doc.sliceString(range.from, range.to)
  return isSpellWord(word) ? word : null
}

/** Adding the word under the pointer to the reader's own list, or taking it out
 *  again. Only while the checker is on: with it off there is no wavy line to
 *  take away, and a row that does nothing visible is a row that lies. */
function spellingEntries(view: EditorView | undefined, event: MouseEvent): MenuEntry[] {
  if (!view || !modes.spellcheck) return []

  // A press on the mark in the margin is about the block and not about a word:
  // the nearest word to the margin is only the first one on the line.
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

/** Opens it at the pointer. One place, so the two things a right click on the
 *  text has to do - build the menu for this moment and place it - stay
 *  together. */
export function showEditorMenu(
  event: MouseEvent,
  view: EditorView | undefined,
  // Null and not only absent: a note that has never been saved has no path, and
  // that is a note like any other until it is written down.
  path?: string | null,
) {
  // Never the precise position: a press on the mark in the margin lands beside
  // the text rather than in it, and that press is about the block it stands by.
  const at = view ? view.posAtCoords({ x: event.clientX, y: event.clientY }, false) : null

  menu.show(
    event,
    [...editorMenu(view, blockEntries(view, at, path)), ...spellingEntries(view, event)],
    { near: true },
  )
}
