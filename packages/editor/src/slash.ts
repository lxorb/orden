/** The `/` menu: the blocks a note is written out of, reachable by typing.
 *
 *  What it is for is the writer who knows what they want and not what it is
 *  called in a menu bar. Notion taught everybody that `/` opens the list; here
 *  it opens the same list the Paragraph menu and the command palette show, which
 *  is the whole point. The rows come from the app - `blockCommands` in
 *  apps/desktop/src/lib/commands.ts - because a second list of blocks is a
 *  second list to keep in step and a second place for one of them to be missing
 *  from.
 *
 *  It is a completion source rather than a menu of its own, so it is the one
 *  popup `[[`, `:emoji:` and the snippets already use: the same surface, the
 *  same rows, the same arrow keys, the same Enter and the same Escape, at the
 *  caret on a desktop and at the caret on a phone. Nothing here draws anything.
 *
 *  A `/` that names nothing is a slash. Nothing to offer closes the popup and
 *  leaves the character exactly where it was typed, which is what has to happen
 *  for `and/or` and for `24/7`. */

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { enclosingNamed } from './nodes'

/** One block the menu offers. The label is already translated: the words belong
 *  to the app, which is where the dictionaries are. */
export interface SlashBlock {
  label: string
  /** What it does, run against whichever view the menu opened in - which is not
   *  always the view the app built the row for, since a note can be open in two
   *  panes at once. */
  run: (view: EditorView) => void
}

/** Asked for the rows rather than handed them, so the words follow the language
 *  the app is set to without anything having to push them again. */
let rows: () => SlashBlock[] = () => []

export function setBlocks(next: () => SlashBlock[]) {
  rows = next
}

/** A `/` at the start of a line or after a space, and whatever has been typed
 *  since. Nowhere else, so `http://` and `</p>` are not somebody asking for a
 *  menu. */
const TYPED = /(?:^|\s)\/([\w-]*)$/

/** Where the characters are code rather than words. */
const VERBATIM = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'CodeMark'])

function inCode(context: CompletionContext): boolean {
  const at = syntaxTree(context.state).resolveInner(context.pos, -1)
  return enclosingNamed(at, VERBATIM) !== null
}

/** Deletes the `/` and what was typed after it, then does the thing.
 *
 *  In that order and in two transactions on purpose: every block command reads
 *  the line it is on to decide whether to open a new one, and `/table` still
 *  sitting there would be a line with words on it. */
function insert(block: SlashBlock) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      // One before `from`, which is the slash itself: the menu filters on what
      // was typed after it, so that is where the completion starts.
      changes: { from: from - 1, to },
      selection: { anchor: from - 1 },
      userEvent: 'input.complete',
    })

    block.run(view)
  }
}

export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const blocks = rows()
  if (!blocks.length) return null

  const line = context.state.doc.lineAt(context.pos)
  const typed = TYPED.exec(line.text.slice(0, context.pos - line.from))
  if (!typed || inCode(context)) return null

  return {
    // Past the slash, so the rows are filtered and marked on the words they
    // actually show rather than on a character that is not part of any of them.
    from: context.pos - (typed[1] ?? '').length,
    // Boosted in the order the app listed them, which is the order the Paragraph
    // menu shows: without it the popup sorts the rows by their own words, and a
    // heading would be somewhere under H. What has been typed still wins, so a
    // narrowed list is ordered by how well each row matches.
    options: blocks.map((block, at) => ({
      label: block.label,
      apply: insert(block),
      type: 'text',
      boost: blocks.length - at,
    })),
    validFor: /^[\w-]*$/,
  }
}
