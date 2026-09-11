/** Colouring a code fence, as classes.
 *
 *  The editor colours what is being typed with CodeMirror's own highlighter, and
 *  that needs a browser. Everything else that shows a fence - an exported
 *  document, a published page - has only a parser and a string, so it writes the
 *  same groups out as classes and lets a stylesheet say what colour each is. The
 *  colours themselves are in themes/document.css, and a reader who has chosen a
 *  code palette writes their own rules over them.
 *
 *  Here rather than in the app, because the Worker that publishes a note needs
 *  exactly this and cannot have the app: one list of groups, one set of class
 *  names, so a fence read in the app and the same fence read by a stranger on a
 *  published page are coloured by one rule. The parsers themselves are the
 *  caller's - the app loads one per language from `@codemirror/language-data`,
 *  and the Worker carries the grammars it can. */

import type { Parser } from '@lezer/common'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { escape as escapeHtml } from './html'

/** Every group a fence is coloured in. The class is `hl-` and the name, and
 *  nothing else in a stylesheet has to know more than this list. */
export const CODE_GROUPS = [
  'keyword',
  'string',
  'number',
  'comment',
  'property',
  'function',
  'type',
  'punctuation',
  'invalid',
  'inserted',
  'deleted',
] as const

export type CodeGroup = (typeof CODE_GROUPS)[number]

/** The same groups the editor colours; see code-theme.ts in @nib/editor, which
 *  says the same thing in styles rather than classes and explains the order.
 *  A name where it is given sits above the function rule, so a function's name
 *  stays a function. */
export const codeHighlighter = tagHighlighter([
  { tag: tags.keyword, class: 'hl-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'hl-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'hl-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'hl-comment' },
  { tag: tags.definition(tags.variableName), class: 'hl-property' },
  { tag: [tags.function(tags.variableName), tags.labelName], class: 'hl-function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'hl-type' },
  { tag: [tags.operator, tags.punctuation], class: 'hl-punctuation' },
  { tag: tags.propertyName, class: 'hl-property' },
  { tag: tags.invalid, class: 'hl-invalid' },
  { tag: tags.inserted, class: 'hl-inserted' },
  { tag: tags.deleted, class: 'hl-deleted' },
])

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

function escape(text: string): string {
  return text.replace(/[&<>]/g, (character) => ESCAPES[character] ?? character)
}

/** The code as HTML, each token wrapped in its class. */
export function highlightCode(code: string, parser: Parser): string {
  let out = ''
  let last = 0

  highlightTree(parser.parse(code), codeHighlighter, (from, to, classes) => {
    out += escape(code.slice(last, from))
    out += `<span class="${classes}">${escape(code.slice(from, to))}</span>`
    last = to
  })

  return out + escape(code.slice(last))
}

/** A whole fence, coloured: the markup marked's own code renderer writes, with
 *  the colouring inside it. One place, so the block an export writes and the one
 *  a published page serves are the same element with the same class on it. */
export function highlightedFence(code: string, language: string, parser: Parser): string {
  const name = language ? ` class="language-${escapeHtml(language)}"` : ''
  return `<pre><code${name}>${highlightCode(code, parser)}\n</code></pre>\n`
}
