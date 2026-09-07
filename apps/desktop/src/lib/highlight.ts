import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { CODE_PALETTES, type CodePalette, fenceLanguages } from '@nib/editor'

export type Parser = LanguageSupport['language']['parser']

/** The same groups the editor colours, as classes rather than styles, so a
 *  document carries one palette in its stylesheet and the markup stays clean. */
const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'hl-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'hl-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'hl-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'hl-comment' },
  // The key in a key=value fence, and a name where it is given - above the
  // function rule so a function's name stays a function; see code-theme.ts.
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

/** A parser for each language named, loaded once. The list is the editor's
 *  own, so an exported document is coloured by whatever coloured it on screen:
 *  a fence may name a language, spell it the short way, or use its file
 *  extension. A language nothing is known about is simply absent, and its code
 *  stays plain. */
export async function loadParsers(names: Iterable<string>): Promise<Map<string, Parser>> {
  const parsers = new Map<string, Parser>()

  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const description =
        LanguageDescription.matchLanguageName(fenceLanguages, name, true) ??
        LanguageDescription.matchFilename(fenceLanguages, `code.${name}`)
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
    // What a diff means, not what a palette makes of it - see code-theme.ts.
    ['inserted', 'var(--success)'],
    ['deleted', 'var(--danger)'],
  ]

  return colours.map(([name, colour]) => `#write .hl-${name} { color: ${colour}; }`).join('\n')
}

const PALETTE_ID = 'nib-code-palette'

/** Puts the chosen palette on the page, for everything the renderer draws
 *  inside `#write`: the reading view, a text card on a canvas, a slide on the
 *  stage. The classes are written by `highlightCode` above and mean nothing
 *  without them, so a fence came out in one colour wherever the app itself was
 *  showing it - an exported document has always carried the same rules in its
 *  own head, which is why it did not.
 *
 *  An id nothing recognises - a palette a later build added - falls back to the
 *  first, which is the one that follows the theme. */
export function paintCodePalette(id: string) {
  const palette = CODE_PALETTES.find((one) => one.id === id) ?? CODE_PALETTES.at(0)

  let sheet = document.getElementById(PALETTE_ID)
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = PALETTE_ID
    // First in the head, so a theme file and a reader's own custom.css both
    // still have the last word on how code is coloured.
    document.head.prepend(sheet)
  }

  sheet.textContent = palette ? paletteCss(palette) : ''
}
