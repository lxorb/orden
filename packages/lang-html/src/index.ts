import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { defineLanguageFacet, Language, LanguageSupport, ParseContext } from '@codemirror/language'
import { EditorState, type Extension, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Parser, type Input, type PartialParse, type TreeFragment } from '@lezer/common'

let here: typeof import('@codemirror/lang-html') | null = null

let held: Promise<typeof import('@codemirror/lang-html')> | null = null

export function htmlGrammar(): Promise<typeof import('@codemirror/lang-html')> {
  return (held ??= import('@codemirror/lang-html').then((module) => {
    closers = EditorState.create({ extensions: module.autoCloseTags }).facet(
      EditorView.inputHandler,
    )
    here = module

    return module
  }))
}

export interface HtmlConfig {
  matchClosingTags?: boolean
  selfClosingTags?: boolean
  autoCloseTags?: boolean
}

class LazyParser extends Parser {
  private real: Parser | null = null

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

const data = defineLanguageFacet({
  commentTokens: { block: { open: '<!--', close: '-->' } },
  indentOnInput: /^\s*<\/\w+\W$/,
  wordChars: '-_',
})

export function html(config: HtmlConfig = {}): LanguageSupport {
  return new LanguageSupport(new Language(data, new LazyParser(config), [], 'html'), [closeTags])
}

type InputHandler = (
  view: EditorView,
  from: number,
  to: number,
  text: string,
  insert: () => Transaction,
) => boolean

let closers: readonly InputHandler[] = []

const closeTags: Extension = EditorView.inputHandler.of((view, from, to, text, insert) =>
  closers.some((close) => close(view, from, to, text, insert)),
)

export function htmlCompletionSource(_context: CompletionContext): CompletionResult | null {
  return null
}
