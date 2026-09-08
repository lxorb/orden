/** A note as an EPUB 3 book: one package, written with `zipOf`.
 *
 *  Two rules decide whether a book opens at all, and both live here. The
 *  `mimetype` entry has to come first and be stored uncompressed, which is why
 *  `zipOf` keeps the order it is given and lets one entry say it is not to be
 *  deflated. And every part of a book is XML: a reader parses an XHTML part
 *  with an XML parser, so an unclosed `<img>`, a bare `checked` or a lone `&`
 *  is not a small mistake but a book that will not open. The renderer writes
 *  HTML, so the body goes through `toXhtml` on the way in.
 *
 *  Maths comes through as KaTeX's own HTML rather than as MathML. KaTeX has
 *  already laid the formula out in spans, that markup is valid XHTML once it is
 *  well formed, and what a reader draws it with is the stylesheet and the fonts
 *  the caller passes in `css`. Handing the layout back to a reader as MathML
 *  would hand it to something that mostly cannot do it. */

import { claimName } from './naming'
import { type Picture, suffixFor } from './pictures'
import { type Entry, zipOf } from './zip'

export interface EpubOptions {
  title: string
  author: string | null
  lang: string
  /** A stable id for this book. The caller passes a urn:uuid or the note path. */
  identifier: string
  /** When the book says it was made, as an ISO instant. Passed in so a build is reproducible. */
  modified: string
  /** The note's rendered body HTML - everything inside `<div id="write">`, with
   *  diagrams already drawn and maths already rendered by KaTeX. */
  body: string
  /** The stylesheet, as text. */
  css: string
  pictures: readonly Picture[]
  /** Which heading level starts a new section: 1 or 2. */
  splitAt?: 1 | 2
}

const MIMETYPE = 'application/epub+zip'
const XHTML_TYPE = 'application/xhtml+xml'
const STYLESHEET = 'styles/document.css'

/** Elements HTML writes without a closing tag. XML has no such list, so each of
 *  them has to say it is empty where it stands. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** The five names XML itself defines. Every other name needs a DTD to be looked
 *  up in, and a part of a book carries none, so an `&nbsp;` written in a note
 *  would stop a reader on the first page. */
const XML_NAMES = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

/** The named references a note actually turns up with, as the numbers that say
 *  the same thing. Numbers need no DTD, so this is how they travel. */
const NUMBERED: Record<string, number> = {
  nbsp: 160,
  pound: 163,
  yen: 165,
  sect: 167,
  copy: 169,
  laquo: 171,
  reg: 174,
  deg: 176,
  plusmn: 177,
  para: 182,
  middot: 183,
  raquo: 187,
  frac14: 188,
  frac12: 189,
  frac34: 190,
  times: 215,
  divide: 247,
  ndash: 8211,
  mdash: 8212,
  lsquo: 8216,
  rsquo: 8217,
  ldquo: 8220,
  rdquo: 8221,
  dagger: 8224,
  bull: 8226,
  hellip: 8230,
  prime: 8242,
  euro: 8364,
  trade: 8482,
  larr: 8592,
  rarr: 8594,
  harr: 8596,
  minus: 8722,
  infin: 8734,
  ne: 8800,
  le: 8804,
  ge: 8805,
}

/** A character reference already written out, a named one, or one of the three
 *  characters that has to become one. */
const CHARACTER = /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+);|&([A-Za-z][A-Za-z0-9]*);|&|<|>|"/g

function referenceOf(name: string): string {
  if (XML_NAMES.has(name)) return `&${name};`

  const code = NUMBERED[name]
  if (code !== undefined) return `&#${code};`

  // A name nothing here knows would make the part unparseable, so it reads as
  // the characters it was written with instead. Words in the wrong shape beat a
  // book that will not open.
  return `&amp;${name};`
}

/** One run of text, or one attribute value, as XML can carry it. `quotes` is on
 *  for an attribute, where a double quote would end the value. */
function escaped(text: string, quotes: boolean): string {
  return text.replace(CHARACTER, (whole: string, name: string | undefined) => {
    if (name !== undefined) return referenceOf(name)
    if (whole === '&') return '&amp;'
    if (whole === '<') return '&lt;'
    if (whole === '>') return '&gt;'
    if (whole === '"') return quotes ? '&quot;' : whole
    return whole
  })
}

/** What the scan reads the markup as. Text and comments carry their words; a
 *  tag carries its name and its attributes exactly as they were written, since
 *  nothing here is allowed to rename or reorder them. */
type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'open'; name: string; attributes: string; empty: boolean; at: number }
  | { kind: 'close'; name: string }

// Sticky, so the scan reads at a position rather than slicing the document once
// per tag. An unquoted attribute value stops at a slash: the renderer quotes
// everything it writes, so an unquoted value comes from raw HTML in the note,
// and reading `<img src=x/>` as self-closing is the safer guess there.
const OPEN =
  /<([A-Za-z][A-Za-z0-9:._-]*)((?:\s+[^\s/>=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>/]*))?)*)\s*(\/?)>/y
const CLOSE = /<\/([A-Za-z][A-Za-z0-9:._-]*)\s*>/y

/** The markup read into pieces. Not a parser: it knows tags from text and
 *  nothing about which element may hold which, which is all either caller
 *  needs. */
function piecesOf(html: string): Piece[] {
  const out: Piece[] = []
  let plain = ''
  let at = 0

  const flush = () => {
    if (plain !== '') out.push({ kind: 'text', text: plain })
    plain = ''
  }

  while (at < html.length) {
    const next = html.indexOf('<', at)
    if (next < 0) {
      plain += html.slice(at)
      break
    }

    plain += html.slice(at, next)

    if (html.startsWith('<!--', next)) {
      const end = html.indexOf('-->', next + 4)
      if (end < 0) {
        // A comment nothing closes would otherwise swallow the rest of the note.
        plain += html.slice(next)
        break
      }
      flush()
      out.push({ kind: 'comment', text: html.slice(next + 4, end) })
      at = end + 3
      continue
    }

    if (html.startsWith('<!', next) || html.startsWith('<?', next)) {
      // A doctype or a processing instruction is not content: every part written
      // here carries its own. Dropped without flushing, so the text around it
      // stays one run.
      const end = html.indexOf('>', next)
      at = end < 0 ? html.length : end + 1
      continue
    }

    CLOSE.lastIndex = next
    const close = CLOSE.exec(html)
    if (close?.[1] !== undefined) {
      flush()
      out.push({ kind: 'close', name: close[1] })
      at = CLOSE.lastIndex
      continue
    }

    OPEN.lastIndex = next
    const open = OPEN.exec(html)
    if (open?.[1] !== undefined) {
      flush()
      out.push({
        kind: 'open',
        name: open[1],
        attributes: open[2] ?? '',
        empty: open[3] === '/',
        at: next,
      })
      at = OPEN.lastIndex
      continue
    }

    // A `<` that starts no tag is a less-than sign the note wrote.
    plain += '<'
    at = next + 1
  }

  flush()
  return out
}

const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g

/** Every attribute written the one way XML accepts: quoted, with its
 *  ampersands spelled out, and never bare. A task list's `<input checked>`
 *  becomes `checked="checked"` - HTML lets the value go, XML does not. A name
 *  written twice keeps its first value, since a repeat is fatal to a parser. */
function attributesOf(source: string): string {
  const seen = new Set<string>()
  let out = ''

  for (const found of source.matchAll(ATTRIBUTE)) {
    const name = found[1]
    if (name === undefined || seen.has(name)) continue
    seen.add(name)

    const value = found[2] ?? found[3] ?? found[4] ?? name
    out += ` ${name}="${escaped(value, true)}"`
  }

  return out
}

/** The close tags a `</name>` stands for: the element itself, and anything
 *  opened inside it that was never closed. `null` closes everything still open.
 *  A close tag matching nothing open is dropped, since there is nothing for it
 *  to end. */
function closing(open: string[], name: string | null): string {
  const from = name === null ? 0 : open.lastIndexOf(name)
  if (from < 0) return ''

  let out = ''
  for (let depth = open.length - 1; depth >= from; depth--) {
    const tag = open[depth]
    if (tag !== undefined) out += `</${tag}>`
  }
  open.length = from

  return out
}

/** The renderer's HTML as XML a parser will take. Nothing is lower-cased and
 *  nothing is reordered: the note's markup comes through as it was written,
 *  with only what XML insists on changed.
 *
 *  Exported because the picture export needs the same thing for its own reason:
 *  a `foreignObject` whose contents are not well-formed XML makes the whole SVG
 *  fail to parse, silently, and the picture comes out blank. */
export function toXhtml(html: string): string {
  const open: string[] = []
  let out = ''

  for (const piece of piecesOf(html)) {
    switch (piece.kind) {
      case 'text':
        out += escaped(piece.text, false)
        break

      case 'comment':
        // XML forbids `--` inside a comment and forbids one ending in `-`, and
        // neither can be written differently without changing what the comment
        // says, so a comment like that goes. `<!--nib:toc-->` and its like stay.
        if (!piece.text.includes('--') && !piece.text.endsWith('-')) {
          out += `<!--${piece.text}-->`
        }
        break

      case 'open': {
        const attributes = attributesOf(piece.attributes)
        if (piece.empty || VOID_ELEMENTS.has(piece.name.toLowerCase())) {
          out += `<${piece.name}${attributes} />`
        } else {
          out += `<${piece.name}${attributes}>`
          open.push(piece.name)
        }
        break
      }

      case 'close':
        out += closing(open, piece.name)
        break
    }
  }

  // Whatever the note left open is closed here rather than left for a reader to
  // refuse the whole book over.
  return out + closing(open, null)
}

/** The body cut into the parts a reader turns between, one per heading at the
 *  split level. The heading stays with the text under it, and whatever stands
 *  before the first heading is a part of its own.
 *
 *  Only a heading at the top level of the body starts a part: one written
 *  inside a quote or a list item is content of that element, and cutting there
 *  would leave both halves malformed. */
export function sectionsOf(xhtml: string, level: 1 | 2): string[] {
  const wanted = `h${level}`
  const cuts: number[] = []
  let depth = 0

  for (const piece of piecesOf(xhtml)) {
    if (piece.kind === 'open') {
      const name = piece.name.toLowerCase()
      if (depth === 0 && name === wanted) cuts.push(piece.at)
      if (!piece.empty && !VOID_ELEMENTS.has(name)) depth++
    } else if (piece.kind === 'close') depth--
  }

  const starts = cuts[0] === 0 ? cuts : [0, ...cuts]
  const cut = starts
    .map((start, index) => xhtml.slice(start, starts[index + 1] ?? xhtml.length))
    .filter((section) => section.trim() !== '')

  // A note with no heading at that level is one part, and so is an empty note:
  // a book needs somewhere to open.
  return cut.length ? cut : ['']
}

const FOOTNOTES = /<section class="footnotes">[\s\S]*?<\/section>/

/** The endnotes taken out of the body, so they can be put back at the end of
 *  the last part.
 *
 *  A footnote is referred to from wherever it was used but shown in one place,
 *  and a reader that turns a book part by part expects that place after the
 *  text rather than in the middle of it - which is where the definitions land
 *  when a note writes them halfway down. */
function withoutFootnotes(xhtml: string): { body: string; footnotes: string } {
  const found = FOOTNOTES.exec(xhtml)
  if (!found) return { body: xhtml, footnotes: '' }

  const body = xhtml.slice(0, found.index) + xhtml.slice(found.index + found[0].length)
  return { body, footnotes: found[0] }
}

function sectionFile(index: number): string {
  return `section-${index + 1}.xhtml`
}

/** Which part of the book each id ended up in. */
function placesOf(sections: readonly string[]): Map<string, number> {
  const places = new Map<string, number>()

  sections.forEach((section, index) => {
    for (const [, id] of section.matchAll(/\sid="([^"]*)"/g)) {
      if (id !== undefined && !places.has(id)) places.set(id, index)
    }
  })

  return places
}

/** Links to another part pointed at that part's file. A book is many files, so
 *  a footnote mark's `href="#fn-1"` in the first part finds nothing: it has to
 *  name the file the id is in. A link inside its own part stays as it is. */
function withCrossLinks(sections: readonly string[]): string[] {
  const places = placesOf(sections)

  return sections.map((section, index) =>
    section.replace(/href="#([^"]*)"/g, (whole: string, id: string) => {
      const place = places.get(id)
      return place === undefined || place === index ? whole : `href="${sectionFile(place)}#${id}"`
    }),
  )
}

/** The words a heading shows, with its markup and its references taken back to
 *  characters, ready to be written into a title. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_whole: string, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const HEADING = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g

interface Mark {
  title: string
  id: string
}

/** One part of the book, as the two tables of contents need it. */
interface Part {
  file: string
  title: string
  /** The headings one level under the split, so a long part can be opened at
   *  the place the reader wants rather than at its top. */
  marks: Mark[]
}

function partOf(section: string, index: number, level: number, bookTitle: string): Part {
  let title: string | null = null
  const marks: Mark[] = []

  for (const [, depth, attributes, inner] of section.matchAll(HEADING)) {
    const words = textOf(inner ?? '')
    const id = /\sid="([^"]*)"/.exec(attributes ?? '')?.[1]

    // At or above the split level, because cutting at h2 leaves the h1 the note
    // opened with standing at the top of the first part, and that is its name.
    if (Number(depth) <= level && title === null) title = words
    else if (Number(depth) === level + 1 && id) marks.push({ title: words, id })
  }

  // A part with no heading at all - everything before the note's first one - is
  // called after the book, which is the truest thing there is to call it.
  return { file: sectionFile(index), title: title ?? bookTitle, marks }
}

/** One picture inside the book. */
interface Image {
  /** The `src` the note wrote, which is the key the body is rewritten by. */
  src: string
  id: string
  /** Where the file goes in the zip, under `OEBPS`. */
  path: string
  /** The same, as a URL a manifest and an `<img>` can carry. */
  href: string
  type: string
  bytes: Uint8Array
}

/** Every picture given a name that is free inside the book. A name with no
 *  extension gets the one its type is normally written with, because a reader
 *  that trusts the name over the manifest still has to get it right. */
function imagesOf(pictures: readonly Picture[]): Image[] {
  const taken = new Set<string>()

  return pictures.map((picture, index) => {
    const wanted = /\.[A-Za-z0-9]+$/.test(picture.name)
      ? picture.name
      : `${picture.name}.${suffixFor(picture.mime)}`
    const name = claimName(wanted, taken)

    return {
      src: picture.src,
      id: `img-${index + 1}`,
      path: `images/${name}`,
      href: `images/${encodeURIComponent(name)}`,
      type: picture.mime,
      bytes: picture.bytes,
    }
  })
}

/** Every `src` the note wrote swapped for the file inside the book.
 *
 *  A picture the caller did not manage to read is not in the map, and its `src`
 *  is left exactly as the note wrote it: a reader may still find the file
 *  beside the book or on the network, while a path invented here would be a
 *  broken picture everywhere. */
function withRewrittenSources(html: string, images: readonly Image[]): string {
  if (!images.length) return html

  const inside = new Map<string, string>()
  for (const image of images) {
    inside.set(image.src, `../${image.href}`)
    // The renderer writes the path into an attribute, so an `&` in it arrives
    // spelled out; the picture's own `src` is the note's spelling.
    inside.set(image.src.replace(/&/g, '&amp;'), `../${image.href}`)
  }

  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]*)(")/g,
    (whole: string, before: string, src: string, after: string) => {
      const swapped = inside.get(src)
      return swapped === undefined ? whole : `${before}${swapped}${after}`
    },
  )
}

/** The instant EPUB 3 asks for: UTC, whole seconds, no fraction. A reader
 *  refuses a date it cannot read, so whatever the caller hands over goes
 *  through `Date` first. */
function instantOf(iso: string): string {
  const when = new Date(iso)
  const at = Number.isNaN(when.getTime()) ? new Date() : when
  return `${at.toISOString().slice(0, 19)}Z`
}

/** One XHTML part of the book: a whole document, since that is what a reader
 *  opens. `css` is the path to the stylesheet from this file. */
function xhtmlDocument(title: string, lang: string, css: string, body: string): string {
  const language = escaped(lang, true)

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head>
<meta charset="utf-8" />
<title>${escaped(title, false)}</title>
<link rel="stylesheet" type="text/css" href="${css}" />
</head>
<body>
${body}
</body>
</html>
`
}

const CONTAINER = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" />
</rootfiles>
</container>
`

/** The EPUB 3 navigation document, which is the table of contents a reader
 *  shows. One entry per part, and a nested level for the headings inside it. */
function navDocument(options: EpubOptions, parts: readonly Part[]): string {
  const items = parts.map((part) => {
    const marks = part.marks
      .map(
        (mark) =>
          `<li><a href="text/${part.file}#${mark.id}">${escaped(mark.title, false)}</a></li>`,
      )
      .join('\n')
    const nested = marks ? `\n<ol>\n${marks}\n</ol>\n` : ''

    return `<li><a href="text/${part.file}">${escaped(part.title, false)}</a>${nested}</li>`
  })

  const body = `<nav epub:type="toc" id="toc">
<h1>${escaped(options.title, false)}</h1>
<ol>
${items.join('\n')}
</ol>
</nav>`

  return xhtmlDocument(options.title, options.lang, STYLESHEET, body)
}

/** The EPUB 2 table of contents, the same tree again.
 *
 *  Written even though the navigation document above says it all, because a
 *  reader built before EPUB 3 - and there are many still in use, on hardware
 *  nobody updates - looks for `toc.ncx` and shows a book with no contents at
 *  all without it. It costs a few hundred bytes. */
function ncxDocument(options: EpubOptions, parts: readonly Part[]): string {
  const point = (order: number, title: string, src: string, nested: string): string =>
    `<navPoint id="navpoint-${order}" playOrder="${order}"><navLabel><text>${escaped(title, false)}</text></navLabel><content src="${src}" />${nested}</navPoint>`

  // The play order reads down the book the way a reader walks it, so a part is
  // numbered before the headings nested under it.
  let order = 0

  const points = parts.map((part) => {
    const own = ++order
    const marks = part.marks.map((mark) =>
      point(++order, mark.title, `text/${part.file}#${mark.id}`, ''),
    )

    return point(own, part.title, `text/${part.file}`, marks.join(''))
  })

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/ns/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${escaped(options.identifier, true)}" />
<meta name="dtb:depth" content="2" />
</head>
<docTitle><text>${escaped(options.title, false)}</text></docTitle>
<navMap>
${points.join('\n')}
</navMap>
</ncx>
`
}

interface ManifestItem {
  id: string
  href: string
  type: string
  /** The navigation document says so, and exactly one item may. */
  nav?: boolean
}

function packageDocument(
  options: EpubOptions,
  items: readonly ManifestItem[],
  spine: readonly string[],
): string {
  const manifest = items
    .map(
      (item) =>
        `<item id="${item.id}" href="${item.href}" media-type="${item.type}"${item.nav ? ' properties="nav"' : ''} />`,
    )
    .join('\n')

  const creator = options.author
    ? `\n<dc:creator>${escaped(options.author, false)}</dc:creator>`
    : ''

  return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="pub-id" xmlns="http://www.idpf.org/2007/opf">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">${escaped(options.identifier, false)}</dc:identifier>
<dc:title>${escaped(options.title, false)}</dc:title>
<dc:language>${escaped(options.lang, false)}</dc:language>${creator}
<meta property="dcterms:modified">${instantOf(options.modified)}</meta>
</metadata>
<manifest>
${manifest}
</manifest>
<spine toc="ncx">
${spine.map((id) => `<itemref idref="${id}" />`).join('\n')}
</spine>
</package>
`
}

export async function toEpub(options: EpubOptions): Promise<Uint8Array> {
  const level = options.splitAt ?? 1
  const images = imagesOf(options.pictures)

  const { body, footnotes } = withoutFootnotes(toXhtml(withRewrittenSources(options.body, images)))
  const split = sectionsOf(body, level)
  const last = split.length - 1
  const sections = withCrossLinks(
    split.map((section, index) => (index === last ? section + footnotes : section)),
  )

  const parts = sections.map((section, index) => partOf(section, index, level, options.title))

  const items: ManifestItem[] = [
    { id: 'nav', href: 'nav.xhtml', type: XHTML_TYPE, nav: true },
    { id: 'ncx', href: 'toc.ncx', type: 'application/x-dtbncx+xml' },
    { id: 'css', href: STYLESHEET, type: 'text/css' },
    ...parts.map((part, index) => ({
      id: `sec-${index + 1}`,
      href: `text/${part.file}`,
      type: XHTML_TYPE,
    })),
    ...images.map((image) => ({ id: image.id, href: image.href, type: image.type })),
  ]

  const entries: Entry[] = [
    // First and stored, which is the one thing a reader is allowed to refuse a
    // book over before it has read anything else.
    { path: 'mimetype', body: MIMETYPE, stored: true },
    { path: 'META-INF/container.xml', body: CONTAINER },
    {
      path: 'OEBPS/package.opf',
      body: packageDocument(
        options,
        items,
        parts.map((_part, index) => `sec-${index + 1}`),
      ),
    },
    { path: 'OEBPS/nav.xhtml', body: navDocument(options, parts) },
    { path: 'OEBPS/toc.ncx', body: ncxDocument(options, parts) },
    { path: `OEBPS/${STYLESHEET}`, body: options.css },
    ...sections.map((section, index) => ({
      path: `OEBPS/text/${sectionFile(index)}`,
      body: xhtmlDocument(
        parts[index]?.title ?? options.title,
        options.lang,
        `../${STYLESHEET}`,
        section,
      ),
    })),
    ...images.map((image) => ({ path: `OEBPS/${image.path}`, body: image.bytes })),
  ]

  return zipOf(entries)
}
