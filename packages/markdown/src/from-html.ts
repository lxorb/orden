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
import { HIGHLIGHT_COLOURS, writeHighlight } from './highlights'

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

/** The TeX a formula carries about itself.
 *
 *  MathML says what a formula means and markdown has no way of writing that down,
 *  but every renderer that emits MathML keeps the source it was built from - as an
 *  annotation inside it, which is where the MathML standard puts it, or as
 *  `alttext` on the element. KaTeX, MathJax and MediaWiki all write both. */
function texOf(maths: Element): string {
  const annotated = maths.querySelector('annotation[encoding="application/x-tex"]')
  const said = annotated?.textContent ?? maths.getAttribute('alttext') ?? ''

  return said.replace(/\s+/g, ' ').trim()
}

/** The elements a formula can have a line of its own inside. Turndown's own list
 *  of what a blank line goes around, narrowed to the ones a page's prose nests a
 *  formula in; a heading is deliberately not among them, because a formula in a
 *  heading is part of the heading and not a block under it. */
const OWNS_A_LINE = new Set(['P', 'DIV', 'DD', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'SECTION', 'BODY'])

const HEADING = /^H[1-6]$/

/** Whether the formula is the whole of the block it sits in.
 *
 *  What decides between the two ways of writing one down, and the page's own
 *  `display` is not it: a site draws a formula on a line of its own with CSS while
 *  leaving it inside the sentence it belongs to, and `$$` in the middle of a
 *  sentence is not a formula to any reader of markdown. So the question is whether
 *  anything else shares the block - the words before and after it, in the page's
 *  own tree. */
function standsAlone(maths: Element): boolean {
  const said = (maths.textContent ?? '').trim()
  let at: Element | null = maths.parentElement

  while (at && !OWNS_A_LINE.has(at.nodeName)) {
    if (HEADING.test(at.nodeName)) return false
    if ((at.textContent ?? '').trim() !== said) return false
    at = at.parentElement
  }

  return !!at && (at.textContent ?? '').trim() === said
}

/** A fence long enough to hold the code, whatever backticks the code contains. */
function fenceFor(code: string): string {
  const longest = [...code.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The language a code block names, from the class or the attribute either half
 *  of it carries.
 *
 *  `language-ts` is the convention and `lang-ts` the older spelling, and both
 *  turn up on the same sites. `data-language` is what the highlighters now write
 *  instead: Shiki names it there and nowhere else, and Shiki is what the docs of
 *  half the tools a note is about are built with, so a clipped snippet used to
 *  arrive as a fence with no language on it and no highlighting anywhere after. */
function languageOf(pre: Element): string {
  const code = pre.querySelector('code')
  const named = [pre, code].reduce((found, one) => {
    return found || one?.getAttribute('data-language') || one?.getAttribute('data-lang') || ''
  }, '')
  if (named.trim()) return named.trim().split(/\s+/)[0] ?? ''

  const classes = `${pre.className} ${code?.className ?? ''}`
  return /(?:language|lang)-(\S+)/.exec(classes)?.[1] ?? ''
}

/** What numbering the lists of a conversion did, counted.
 *
 *  Here for from-html.test.ts, which asserts these rather than a stopwatch. A
 *  five thousand item list used to be held to a wall-clock budget of a second and
 *  answered 1,400 ms on a runner with the rest of the suite on it, failing a test
 *  that had found nothing wrong; the same commit passed on its own minutes
 *  earlier. A timing is a proxy for the work done and a poor one, because what it
 *  measures is partly the queue in front of the code. These three are the same
 *  numbers on a busy machine as on an idle one, and between them they say the
 *  thing the test is about: one count per list rather than one per item.
 *
 *  Three adds over a conversion that walks a whole page. */
export interface Work {
  /** Lists counted out: one per parent, however many items hang off it. */
  lists: number
  /** Items that asked where they sit among their siblings. */
  items: number
  /** Siblings stepped over while counting those lists out. The one worth
   *  catching: a list is walked once, so this is the length of the list, and a
   *  return to a walk for every item makes it the length squared. */
  walked: number
}

function nothing(): Work {
  return { lists: 0, items: 0, walked: 0 }
}

const work = nothing()

/** What the conversions since this was last asked did, and zero from here. */
export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

/** Where a node sits among its parent's elements, which is what numbers an item
 *  of an ordered list.
 *
 *  One count per parent, not per child: the walk this used to do over the
 *  parent's children was a walk for every item, so numbering a list cost a pass
 *  over the list for each line of it. The first item counts its siblings out and
 *  the rest read the answer. Counted out rather than spread: a browser's
 *  `HTMLCollection` can be iterated and the small DOM turndown carries for node
 *  cannot. */
function indexer(): (parent: Element | null, node: Node) => number {
  const counted = new WeakMap<Element, Map<Node, number>>()

  return (parent, node) => {
    if (!parent) return 0

    work.items += 1
    let places = counted.get(parent)

    if (!places) {
      work.lists += 1
      places = new Map()
      const kids = parent.children

      for (let at = 0; at < kids.length; at++) {
        work.walked += 1
        const kid = kids[at]
        if (kid) places.set(kid, at)
      }

      counted.set(parent, places)
    }

    return places.get(node) ?? 0
  }
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
 *  Exported because the clipper fills its picture placeholders in after the
 *  conversion, when there is a blob to point at, and both halves of a clip have to
 *  say an address the same way. It had its own copy built on `encodeURI`, which
 *  escapes the percent as well: an address the page had already escaped came back
 *  escaping its own escapes, and `a%20b.png` was saved as `a%2520b.png`. The
 *  percent is not touched here - an address that already carries escapes stays the
 *  address it was. */
export function destination(address: string): string {
  return address.replace(IN_DESTINATION, (character) => {
    return KEPT[character] ?? encodeURIComponent(character)
  })
}

/** What a link says about itself, in the quotes markdown gives a title, or
 *  nothing at all.
 *
 *  Escaping the quote is what turndown does and it left the backslash that
 *  escapes the quote: a title ending in `\` closed nothing, and what followed the
 *  link was read as more of the title. A link keeps its title where a picture has
 *  none, because a link's address is the page's own - only a picture goes through
 *  a caller's hook, so there is no numbered placeholder here for a title to stand
 *  in front of. */
function titleOf(link: Element): string {
  const title = (link.getAttribute('title') ?? '')
    .replace(/\s+/g, ' ')
    .replace(/(["\\])/g, '\\$1')
    .trim()

  return title ? ` "${title}"` : ''
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

  // Kept for the one conversion, because the tree it counts lives for one
  // conversion.
  const indexIn = indexer()

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

  // Highlighted text has a markdown form here, so keep it rather than drop it -
  // and its colour has one too, so a highlight copied out of the reading view and
  // pasted back is still the colour it was. The class is the one the renderer
  // writes; a `<mark>` from anywhere else is a highlight with no colour of its
  // own, which is what it looks like.
  service.addRule('highlight', {
    filter: ['mark'],
    replacement: (content, node) => {
      if (!content) return ''

      const named = (node as Element).className
      const found = HIGHLIGHT_COLOURS.find((one) => one.className && one.className === named)
      return `==${found ? writeHighlight(content, found) : content}==`
    },
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

  // A formula, as the `$…$` this editor and Obsidian both draw. MathML is what a
  // page renders one as, and the TeX it was built from travels inside it, so the
  // note keeps the formula rather than the letters it was made of: a clipped
  // Euler's identity is `e^{i\pi}+1=0` and not `eiπ+1=0`.
  //
  // Written by the rule rather than as text, because text is escaped: every `\`
  // in the formula would come back doubled and the note would draw nothing.
  service.addRule('maths', {
    filter: 'math',
    replacement: (content, node) => {
      const tex = texOf(node as Element)
      if (!tex) return content

      if (standsAlone(node as Element)) return `\n\n$$\n${tex}\n$$\n\n`

      // A dollar inside the formula is the one thing that would close it early,
      // and `\$` is how TeX writes one anyway. One that the page had already
      // escaped is left alone, or the escape would come back escaping itself.
      return `$${tex.replace(/(?<!\\)\$/g, '\\$')}$`
    },
  })

  // An address is an address whether a picture or a link carries it, and
  // turndown escapes the one in an `href` the way this used to escape the one in
  // a `src`: a `\` on the page ended the destination early, and the rest of the
  // attribute became a link of the page's own after it. So a link is written here
  // too, through the same encoder.
  //
  // One rule for both of turndown's, which are an inlined link and a referenced
  // one; the converter asks for inlined, and a rule added here answers before
  // either of them whatever it asks for.
  //
  // The words keep the escaping they arrive with. A link's text is markdown by
  // the time it reaches this - the emphasis inside it, or a picture of its own -
  // and its text nodes have been through `escape` above, which is where a
  // backslash and the brackets are already dealt with.
  service.addRule('link', {
    filter: (node) => node.nodeName === 'A' && !!node.getAttribute('href'),
    replacement: (content, node) =>
      `[${content}](${destination(node.getAttribute('href') ?? '')}${titleOf(node)})`,
  })

  // The two things a picture says, and no `title`, which is the one place it
  // differs from a link: a caller's address arrives after the conversion, and the
  // clipper fills its numbers in by the shape `](nib:0)`, so a title written
  // between them would leave the placeholder in the note. A page's own goes with
  // the rest of the attributes, and there is no third string here to break out
  // of a title's quotes.
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
