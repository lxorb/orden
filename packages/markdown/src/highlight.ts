import type { Parser } from '@lezer/common'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { escape } from './html'

const codeHighlighter = tagHighlighter([
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

const IN_CODE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

function escapeCode(text: string): string {
  return text.replace(/[&<>]/g, (character) => IN_CODE[character] ?? character)
}

export function highlightCode(code: string, parser: Parser): string {
  let out = ''
  let last = 0

  highlightTree(parser.parse(code), codeHighlighter, (from, to, classes) => {
    out += escapeCode(code.slice(last, from))
    out += `<span class="${classes}">${escapeCode(code.slice(from, to))}</span>`
    last = to
  })

  return out + escapeCode(code.slice(last))
}

export function highlightedFence(code: string, language: string, parser: Parser): string {
  const name = language ? ` class="language-${escape(language)}"` : ''
  return `<pre><code${name}>${highlightCode(code, parser)}\n</code></pre>\n`
}
