import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import type { CodePalette } from '@nib/editor'

export type Parser = LanguageSupport['language']['parser']

/** The same groups the editor colours, as classes rather than styles, so a
 *  document carries one palette in its stylesheet and the markup stays clean. */
const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'hl-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'hl-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'hl-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'hl-comment' },
  { tag: [tags.function(tags.variableName), tags.labelName], class: 'hl-function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'hl-type' },
  { tag: [tags.operator, tags.punctuation], class: 'hl-punctuation' },
  { tag: tags.propertyName, class: 'hl-property' },
  { tag: tags.invalid, class: 'hl-invalid' },
])

function escape(text: string): string {
  return text.replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!,
  )
}

/** A parser for each language named, loaded once. A fence may name a language
 *  or use its file extension, as ` ```py ` does. A language nothing is known
 *  about is simply absent, and its code stays plain. */
export async function loadParsers(names: Iterable<string>): Promise<Map<string, Parser>> {
  const parsers = new Map<string, Parser>()

  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const description =
        LanguageDescription.matchLanguageName(languages, name, true) ??
        LanguageDescription.matchFilename(languages, `code.${name}`)
      if (!description) return

      const support = await description.load().catch(() => null)
      if (support) parsers.set(name, support.language.parser)
    }),
  )

  return parsers
}

/** The code as HTML, each token wrapped in its class. */
export function highlightCode(code: string, parser: Parser): string {
  let out = ''
  let last = 0

  highlightTree(parser.parse(code), highlighter, (from, to, classes) => {
    out += escape(code.slice(last, from))
    out += `<span class="${classes}">${escape(code.slice(from, to))}</span>`
    last = to
  })

  return out + escape(code.slice(last))
}

/** One rule per class, in the palette's colours. `var()` values resolve
 *  against the theme tokens the document carries. */
export function paletteCss(palette: CodePalette): string {
  const colours: [string, string][] = [
    ['keyword', palette.keyword],
    ['string', palette.string],
    ['number', palette.number],
    ['comment', palette.comment],
    ['function', palette.function],
    ['type', palette.type],
    ['punctuation', palette.punctuation],
    ['property', palette.property],
    ['invalid', 'var(--danger)'],
  ]

  return colours.map(([name, colour]) => `#write .hl-${name} { color: ${colour}; }`).join('\n')
}
