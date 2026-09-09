/** HTML into the markdown Nib writes.
 *
 *  The other direction, and the same opinions read backwards: the markers here
 *  are the ones the editor's own formatting commands produce, so a page pasted
 *  into a note, an article the clipper saved and a note typed by hand are the
 *  same kind of file. Turndown does the walking, with the GFM rules on top for
 *  tables, task lists and strikethrough.
 *
 *  One copy of it, because there were two: the editor's paste and the clipper
 *  had each grown their own set of rules, and a page pasted into the app came
 *  out with three spaces after every bullet while the same page clipped came out
 *  with one. Whoever needs it imports it from here.
 *
 *  Pictures are the one thing a caller decides. The clipper has no address for
 *  them yet - the bytes are still on the site, and the address is the hash of
 *  bytes nobody has fetched - so it numbers them instead; a paste has the
 *  addresses already and keeps them. */

import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

/** What a note never contains.
 *
 *  Chrome, layout and interaction, none of which survives the trip into
 *  markdown: a script's source would arrive as a paragraph of code, a stylesheet
 *  as a paragraph of rules, a page's `<title>` as a line of prose above the
 *  heading it repeats. */
export const NEVER = [
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'title',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas',
  'video',
  'audio',
]

export interface FromHtmlOptions {
  /** What a picture becomes. The default writes the address the page gave it. */
  image?: (source: string, alt: string) => string
}

/** A fence long enough to hold the code, whatever backticks the code contains. */
function fenceFor(code: string): string {
  const longest = [...code.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The language a code block names, from the class either half of it carries.
 *  `language-ts` is the convention; `lang-ts` is the older spelling, and both
 *  turn up on the same sites. */
function languageOf(pre: Element): string {
  const code = pre.querySelector('code')
  const classes = `${pre.className} ${code?.className ?? ''}`
  return /(?:language|lang)-(\S+)/.exec(classes)?.[1] ?? ''
}

/** Where a node sits among its parent's elements, which is what numbers an item of
 *  an ordered list. Counted out rather than spread: a browser's `HTMLCollection`
 *  can be iterated and the small DOM turndown carries for node cannot. */
function indexIn(parent: Element | null, node: Node): number {
  if (!parent) return 0

  const kids = parent.children
  for (let at = 0; at < kids.length; at++) if (kids[at] === node) return at
  return 0
}

/** Alt text that cannot break out of its own brackets.
 *
 *  A backslash is one of the ways out, and the one that was left: alt text
 *  ending in `\` had its escaped bracket escaped instead, the words closed early
 *  and the address after them was the page's rather than the picture's. */
function altOf(image: Element): string {
  return (image.getAttribute('alt') ?? '')
    .replace(/\s+/g, ' ')
    .replace(/([\\[\]])/g, '\\$1')
    .trim()
}

/** A `<` the note would read as the start of a tag, a closing tag, a comment or
 *  a processing instruction: the four things CommonMark lets raw HTML begin
 *  with. `a < b` is not one of them and keeps its bracket.
 *
 *  Anything else is markup, and a page's words are words. A page showing what a
 *  tag looks like is the commonest thing anybody copies, and the note that came
 *  out of it held a tag its writer never wrote - which the reading view, an
 *  export and a canvas card all render, because a note's own HTML is the note's.
 *  So the bracket is escaped, which is how markdown writes a literal one. */
const OPENS_MARKUP = /<(?=[A-Za-z/!?])/g

/** Everything markdown reads inside a destination: the brackets that end one,
 *  the angle brackets that open and close the other spelling of one, the
 *  backslash that escapes any of them, the quote that opens a title, and the
 *  blanks and control characters that end a bare destination. */
const IN_DESTINATION = /[\s\p{Cc}()<>\\"]/gu

/** The two `encodeURIComponent` keeps, which are the two that end a destination. */
const KEPT: Record<string, string> = { '(': '%28', ')': '%29' }

/** An address as a markdown destination that cannot be broken out of.
 *
 *  Percent encoded rather than escaped with backslashes. Escaping is what
 *  turndown does for a link and what this copied, and it left the escape itself:
 *  a `\` the page put in the address escaped the backslash turndown wrote, the
 *  destination ended at the bracket after it, and the rest of the attribute was
 *  written into the note as markdown of its own - a second picture, pointing at
 *  whatever host the pasted HTML named. An address is a URL and a URL says the
 *  same thing percent encoded, so there is nothing left to escape and nothing
 *  left to end early. `File_(1).png`, which Wikipedia writes, comes out as one
 *  address rather than as an address and a bracket of prose.
 *
 *  The same shape the clipper's placeholders are filled with afterwards, so both
 *  halves of a clip say it the same way. The percent itself is not touched: an
 *  address that already carries escapes stays the address it was rather than
 *  becoming one that escapes its own escapes. */
function destination(address: string): string {
  return address.replace(IN_DESTINATION, (character) => {
    return KEPT[character] ?? encodeURIComponent(character)
  })
}

function converter(options: FromHtmlOptions): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  service.use(gfm)

  // Turndown escapes the markdown a page's text would otherwise read as; a `<`
  // is the one it leaves, and the one that matters most here. Wrapped rather
  // than replaced, and hung on the instance because that is where turndown looks
  // it up - and it looks it up only for text that is not inside code, which is
  // what keeps a fence's own brackets intact.
  const escapeMarkdown = service.escape.bind(service)
  service.escape = (text: string) => escapeMarkdown(text).replace(OPENS_MARKUP, '\\<')

  // A filter rather than the list itself, because `svg` is not an HTML tag and
  // the list is one. For the clipper this is a second line of defence behind its
  // own DOM cleaning; for a paste it is the only one, since a clipboard's HTML
  // arrives as a whole document with a head on it.
  service.remove((node) => NEVER.includes(node.nodeName.toLowerCase()))

  // A list item, with one space after its marker rather than turndown's three.
  // Nib writes `- item`, and a note full of `-   item` is a note that looks like
  // it came from somewhere else. Nested lines line up under the text, which is
  // what makes the nesting readable in the source.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, settings) => {
      const parent = node.parentNode as Element | null
      const ordered = parent?.nodeName === 'OL'
      const from = Number(parent?.getAttribute('start') ?? 1) || 1
      const at = indexIn(parent, node)

      const marker = ordered ? `${from + at}.` : (settings.bulletListMarker ?? '-')
      const indent = ' '.repeat(marker.length + 1)

      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/g, `\n${indent}`)
        // A ticked item brings its box and the space the page had after it; one
        // space between the box and the words is what markdown wants.
        .replace(/^(\[[ x]\])\s*/, '$1 ')

      const ends = node.nextSibling && !body.endsWith('\n') ? '\n' : ''
      return `${marker} ${body}${ends}`
    },
  })

  // GitHub's own spelling, which is the one the editor's format bar writes. The
  // plugin still says `~single~`, which this editor's parser reads as subscript.
  service.addRule('struck', {
    filter: ['del', 's'],
    replacement: (content) => (content ? `~~${content}~~` : ''),
  })

  // Highlighted text has a markdown form here, so keep it rather than drop it.
  service.addRule('highlight', {
    filter: ['mark'],
    replacement: (content) => (content ? `==${content}==` : ''),
  })

  // Underline has none, so the tag itself is the markdown; the editor renders it.
  service.addRule('underline', {
    filter: ['u'],
    replacement: (content) => (content ? `<u>${content}</u>` : ''),
  })

  // One rule for every preformatted block, whether or not it wraps a `code`.
  // Turndown's own fenced rule wants the pair, and a bare `pre` would otherwise
  // come out as a paragraph with its indentation collapsed.
  service.addRule('preformatted', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = node.textContent.replace(/\n+$/, '')
      if (!code.trim()) return ''

      const fence = fenceFor(code)
      return `\n\n${fence}${languageOf(node)}\n${code}\n${fence}\n\n`
    },
  })

  // The two things a picture says, and no `title`: nothing in a note shows one,
  // and a caller's address arrives afterwards - the clipper fills its numbers in
  // by the shape `](nib:0)`, so a title written between them would leave the
  // placeholder in the note. So there is no third string here to break out of a
  // title's quotes, and a page's own `title` is dropped with the rest of the
  // attributes.
  service.addRule('picture', {
    filter: 'img',
    replacement: (_content, node) => {
      const source = node.getAttribute('src') ?? ''
      if (!source) return ''

      const alt = altOf(node)
      return `![${alt}](${destination(options.image ? options.image(source, alt) : source)})`
    },
  })

  return service
}

/** Blank lines are how markdown separates blocks, and more than one of them says
 *  nothing extra. Trailing spaces on a line mean a hard break, so only the ones
 *  on otherwise empty lines go. */
function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function htmlToMarkdown(html: string, options: FromHtmlOptions = {}): string {
  if (!html.trim()) return ''
  return tidy(converter(options).turndown(html))
}
