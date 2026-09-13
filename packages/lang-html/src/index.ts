import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { defineLanguageFacet, Language, LanguageSupport, ParseContext } from '@codemirror/language'
import { EditorState, type Extension, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Parser, type Input, type PartialParse, type TreeFragment } from '@lezer/common'

/** The HTML grammar a note's raw blocks and inline tags are coloured by, fetched when
 *  a note turns out to have one in it.
 *
 *  This package is what `@codemirror/lang-markdown` gets when it asks for
 *  `@codemirror/lang-html`. The root manifest says so - see `overrides` in package.json
 *  - and the reason is the one static import of that grammar at the top of that
 *  package, which brings `html` and `htmlCompletionSource` in for `markdown()` to build
 *  its nested parser out of.
 *
 *  Raw HTML blocks and inline tags are part of nib's markdown, so `markdown()` wants a
 *  grammar for them, and the one it reaches for brings the CSS and JavaScript grammars
 *  with it for `<style>` and `<script>`, and the LR parser runtime under all three -
 *  which nothing else in front of the first paint needs, markdown's own parser being
 *  written by hand. Six packages and a hundred and sixty-seven kilobytes, evaluated
 *  before the window has drawn anything, for the notes that have a tag in them: four
 *  requests and 166,966 bytes, counted out of the browser's own resource timing, and
 *  fourteen milliseconds to fetch warm, parse and run, measured in Chrome on the machine
 *  this was written on.
 *
 *  Nothing here parses HTML. `html()` below answers with a parser that skips the region
 *  and fetches the real grammar, and CodeMirror parses the region again when it lands -
 *  which is the mechanism a fence's language already arrives by, and the one the parser
 *  of a fence with an unloaded language has always used. So a note's HTML is plain for
 *  as long as one fetch takes and coloured after, and everything else about it - the
 *  nesting, the tag matching, the closing tag a `>` writes - is the real grammar's own
 *  work.
 *
 *  Why an override rather than a call: `markdown()` takes an `htmlTagLanguage` and
 *  would have taken this, but its default is built at module level, so the import
 *  stands whether or not anybody passes one. And the export that reads it cannot be
 *  dropped by the bundler either: `@codemirror/language-data` names `markdown()` for
 *  the ```markdown fence, which keeps every export of that module alive in whatever
 *  chunk holds it - and the editor holds it in the first one, because the base parser
 *  and the two keys that continue a list are in it. One substitution in the manifest
 *  is what is left, and it is the whole of the change: the editor asks for markdown
 *  exactly as it did.
 *
 *  Read alongside packages/editor/src/languages.ts, which is the same bargain for the
 *  hundred and forty-three languages a fence can name. */

/** The grammar once it is here, as the module it came in. */
let here: typeof import('@codemirror/lang-html') | null = null

/** The one fetch of it, kept: a note of twenty tags is one fetch. */
let held: Promise<typeof import('@codemirror/lang-html')> | null = null

/** The real grammar, fetched once.
 *
 *  Exported for the tests - nib's own and the editor's, which hold a cold parse and a
 *  warm one to each other - and called by the parser below, which is what asks for it
 *  when a note turns out to have a tag in it. */
export function htmlGrammar(): Promise<typeof import('@codemirror/lang-html')> {
  return (held ??= import('@codemirror/lang-html').then((module) => {
    // The one extension in the real support that a note can feel; see `closeTags`.
    closers = EditorState.create({ extensions: module.autoCloseTags }).facet(
      EditorView.inputHandler,
    )
    here = module

    return module
  }))
}

/** What `html()` is asked for, as much of it as anything here reads. The real
 *  signature has more in it; a configuration this does not know about is handed on
 *  unread, so the grammar that arrives is configured the way the caller asked. */
export interface HtmlConfig {
  matchClosingTags?: boolean
  selfClosingTags?: boolean
  autoCloseTags?: boolean
}

/** An HTML parse, before and after the grammar is here.
 *
 *  One instance per `html()`, held by whatever configured parser was built around it,
 *  so the grammar arriving changes what a parse does rather than what the editor is
 *  configured with - nothing is rebuilt and nothing on screen is thrown away for it.
 *
 *  `getSkippingParser` is CodeMirror's own answer to a parser that is still on its way:
 *  it leaves the region unparsed, notes the promise on the parse, and the language
 *  parses the region again when it resolves. */
class LazyParser extends Parser {
  /** The real one, built from the configuration this was asked for and kept: a parser
   *  built again per parse is a parse that can reuse nothing of the last one. */
  private real: Parser | null = null

  /** What `html()` was asked for, kept so the grammar arrives configured that way.
   *
   *  Assigned here rather than declared in the parameter list: this package is read as
   *  source by everything that reads it, and a parameter property is syntax some of
   *  those readers strip types without understanding. */
  private readonly config: HtmlConfig

  constructor(config: HtmlConfig) {
    super()
    this.config = config
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const grammar = here
    if (grammar) {
      this.real ??= grammar.html(this.config).language.parser

      return this.real.createParse(input, fragments, ranges)
    }

    return ParseContext.getSkippingParser(htmlGrammar()).createParse(input, fragments, ranges)
  }
}

/** What the real `htmlLanguage` says about itself, said here too.
 *
 *  Nothing asks: `markdown()` reads the parser out of this language and nothing else,
 *  and once the grammar is here the tree a region is parsed into is the real
 *  language's, carrying the real language's own data. It is here so that a reader who
 *  does ask, in the seconds before the grammar lands, is told what HTML is rather than
 *  what markdown is. */
const data = defineLanguageFacet({
  commentTokens: { block: { open: '<!--', close: '-->' } },
  indentOnInput: /^\s*<\/\w+\W$/,
  wordChars: '-_',
})

/** HTML as a language, with the grammar still to come.
 *
 *  The support is the close-tag handler and nothing else. What the real support also
 *  holds is three completion sources - HTML's own, and JavaScript's and CSS's for what
 *  is nested inside it - and none of the three has ever run in nib or can: the popup is
 *  built with `override`, which is the whole list of sources rather than an addition to
 *  it, so a source offered through language data is never asked. See `completing` in
 *  packages/editor/src/completing.ts. The same goes for the tag completion `markdown()`
 *  adds beside them, which is what `htmlCompletionSource` below is for - and which is
 *  also why the completion library itself is not in the first paint; see
 *  packages/autocomplete. */
export function html(config: HtmlConfig = {}): LanguageSupport {
  return new LanguageSupport(new Language(data, new LazyParser(config), [], 'html'), [closeTags])
}

/** The handlers the real support puts on `>` and `/`, once it is here. */
type InputHandler = (
  view: EditorView,
  from: number,
  to: number,
  text: string,
  insert: () => Transaction,
) => boolean

let closers: readonly InputHandler[] = []

/** A tag closed by the `>` that finishes it, which is the one thing the HTML support
 *  does to a note beyond colouring it.
 *
 *  In the configuration from the start, and delegating to the real handler once the
 *  grammar is here - resolved out of the extension it comes in, which is what a facet
 *  is for. So the arrival reconfigures nothing: a note that has just had its first tag
 *  typed into it keeps its parse, its folds and its scroll. */
const closeTags: Extension = EditorView.inputHandler.of((view, from, to, text, insert) =>
  closers.some((close) => close(view, from, to, text, insert)),
)

/** The completions offered inside a tag: none, ever.
 *
 *  `markdown()` asks for these once, through a source of its own, to offer tag names
 *  when a `<` is typed in a note. Nothing in nib ever reaches it - see the note on
 *  `html` above - and there are two reasons it answers nothing rather than delegating
 *  to the real grammar when the grammar is here.
 *
 *  The first is what a context is now. `markdown()` builds one to ask this with, and
 *  the class it builds is nib's own: that package's static import of the completion
 *  library held thirty-five kilobytes of popup in front of the first paint, so it gets
 *  packages/autocomplete instead, which carries the three things a context is made of
 *  and nothing else. Handing that to the real grammar's source would be a lie, and the
 *  one caller is a source nothing asks.
 *
 *  The second is that it is not what fetches the grammar. A reader who has typed a `<`
 *  has not asked for a hundred and sixty-seven kilobytes, and the parse that finds a tag
 *  in the note is already asking. */
export function htmlCompletionSource(_context: CompletionContext): CompletionResult | null {
  return null
}
