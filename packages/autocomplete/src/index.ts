import type { EditorState } from '@codemirror/state'

/** What `@codemirror/lang-markdown` gets when it asks for `@codemirror/autocomplete`.
 *
 *  The same bargain packages/lang-html is, one import further along, and for the same
 *  reason: the markdown language imports the completion package at the top of its
 *  module, so the whole of it - thirty-five kilobytes of built JavaScript, the popup,
 *  the snippets, the bracket pairs - was evaluated before the window had drawn
 *  anything, in order to show a note. The root manifest substitutes this instead; see
 *  `overrides` in package.json.
 *
 *  It needs exactly one name, and uses it in exactly one place. `markdown()` offers the
 *  names of HTML tags when a `<` is typed in a note, through a completion source it
 *  registers in the language's own data, and that source builds a `CompletionContext`
 *  in order to ask HTML's own source what the tags are.
 *
 *  Nothing in nib reaches it. The popup is built with `override`, which is the whole
 *  list of sources rather than an addition to it, so a source offered through language
 *  data is never asked - see `completing` in packages/editor/src/completing.ts, which is
 *  that list. And the source it would reach is packages/lang-html's, which answers
 *  nothing at all rather than be handed a context that is not the library's.
 *
 *  So this is not the library's class and does not pretend to be one. It carries the
 *  three things a context is made of, because that is what a caller can read off one
 *  without asking the popup anything, and nothing else. Where the real completion
 *  package is wanted - by the popup, by the bracket pairs - it is imported by name and
 *  fetched as the first editor is built; see packages/editor/src/completion.ts. */
export class CompletionContext {
  /** The document the completion was asked about. */
  readonly state: EditorState
  /** Where in it the caret was. */
  readonly pos: number
  /** Whether a key asked for the popup rather than a keystroke opening it. */
  readonly explicit: boolean

  constructor(state: EditorState, pos: number, explicit: boolean) {
    this.state = state
    this.pos = pos
    this.explicit = explicit
  }
}
