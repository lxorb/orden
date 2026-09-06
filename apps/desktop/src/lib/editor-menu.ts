import {
  clearFormatting,
  type EditorView,
  insertCodeFence,
  insertHorizontalRule,
  insertLink,
  insertPageBreak,
  insertTableToEdit,
  type StateCommand,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleWrap,
  type Transaction,
} from '@nib/editor'
import { copySelection, cutSelection } from './clipboard'
import { t } from './i18n.svelte'
import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
import { modes } from './modes.svelte'
import { shortcuts } from './shortcuts.svelte'
import { viewport } from './viewport.svelte'

/** The editor's own context menu, so the browser's never appears.
 *
 *  Everything here calls the same commands the keyboard and the app menu call;
 *  what differs is how much of it is offered. A phone gets the clipboard alone,
 *  and reading mode gets the clipboard plus the way back out - a menu of things
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

function editorMenu(view: EditorView | undefined): MenuEntry[] {
  const selected = !!view && !view.state.selection.main.empty
  const reading = !!view && view.state.readOnly
  const run = (command: StateCommand) => () => runCommand(view, command)

  const clipboard: MenuEntry[] = [
    {
      label: t('Cut'),
      hint: shortcuts.hint('fixed.cut'),
      disabled: !selected || reading,
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
      disabled: reading,
      run: () => {
        if (view) void paste(view)
      },
    },
  ]

  // On a phone a press on the text is for the clipboard, the way it is in
  // every other app there. The formatting lives in the bar above the
  // keyboard and in the app menu, and sixteen rows would cover the text
  // they are about.
  if (viewport.phone) return clipboard

  // Reading mode leaves the clipboard rows and the way back out. The rest of
  // this menu writes.
  if (reading) {
    return [
      ...clipboard,
      DIVIDER,
      {
        label: t('Leave reading mode'),
        hint: shortcuts.hint('app.reading'),
        run: () => modes.toggleReading(view),
      },
    ]
  }

  return [
    ...clipboard,
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
    {
      label: modes.source ? t('Leave source mode') : t('Source mode'),
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
  ]
}

/** Opens it at the pointer. One place, so the two things a right click on the
 *  text has to do - build the menu for this moment and place it - stay
 *  together. */
export function showEditorMenu(event: MouseEvent, view: EditorView | undefined) {
  menu.show(event, editorMenu(view), { near: true })
}
