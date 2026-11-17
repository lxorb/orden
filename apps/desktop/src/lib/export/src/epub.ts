import { mapSources } from '@orden/markdown/sources'
import { claimName } from '../../files-out/src/api'
import { type ZipEntry as Entry, zipOf } from '../../files-out/src/api'
import { type Picture, suffixFor } from './pictures'
import { legalCode, legalXml } from './xml-legal'

export interface EpubOptions {
  title: string
  author: string | null
  lang: string
  identifier: string
  modified: string
  body: string
  css: string
  pictures: readonly Picture[]
  splitAt?: 1 | 2
}

const MIMETYPE = 'application/epub+zip'
const XHTML_TYPE = 'application/xhtml+xml'
const STYLESHEET = 'styles/document.css'

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

const XML_NAMES = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

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

const CHARACTER = /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+);|&([A-Za-z][A-Za-z0-9]*);|&|<|>|"/g

function referenceOf(name: string): string {
  if (XML_NAMES.has(name)) return `&${name};`

  const code = NUMBERED[name]
  if (code !== undefined) return `&#${code};`

  return `&amp;${name};`
}

function legalReference(reference: string): boolean {
  const hex = /x/i.test(reference.charAt(2))
  return legalCode(Number.parseInt(reference.slice(hex ? 3 : 2), hex ? 16 : 10))
}

function escaped(text: string, quotes: boolean): string {
  return legalXml(text).replace(CHARACTER, (whole: string, name: string | undefined) => {
    if (name !== undefined) return referenceOf(name)
    if (whole.startsWith('&#')) return legalReference(whole) ? whole.replace('&#X', '&#x') : ''
    if (whole === '&') return '&amp;'
    if (whole === '<') return '&lt;'
    if (whole === '>') return '&gt;'
    if (whole === '"') return quotes ? '&quot;' : whole
    return whole
  })
}

type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'open'; name: string; attributes: string; empty: boolean; at: number }
  | { kind: 'close'; name: string }

const OPEN =
  /<([A-Za-z][A-Za-z0-9:._-]*)((?:\s+[^\s/>=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>/]*))?)*)\s*(\/?)>/y
const CLOSE = /<\/([A-Za-z][A-Za-z0-9:._-]*)\s*>/y

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
        plain += html.slice(next)
        break
      }
      flush()
      out.push({ kind: 'comment', text: html.slice(next + 4, end) })
      at = end + 3
      continue
    }

    if (html.startsWith('<!', next) || html.startsWith('<?', next)) {
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

    plain += '<'
    at = next + 1
  }

  flush()
  return out
}

const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])

function attributesOf(source: string): string {
  const seen = new Set<string>()
  let out = ''

  for (const found of source.matchAll(ATTRIBUTE)) {
    const name = found[1]
    if (name === undefined || seen.has(name)) continue
    seen.add(name)

    const value = found[2] ?? found[3] ?? found[4] ?? name

    if (name.toLowerCase() === 'align' && ALIGNMENTS.has(value.toLowerCase())) {
      if (seen.has('style')) continue

      seen.add('style')
      out += ` style="text-align: ${value.toLowerCase()}"`
      continue
    }

    out += ` ${name}="${escaped(value, true)}"`
  }

  return out
}

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

const XHTML = 'http://www.w3.org/1999/xhtml'
const FOREIGN_ROOTS: Record<string, string> = {
  svg: 'http://www.w3.org/2000/svg',
  math: 'http://www.w3.org/1998/Math/MathML',
}

function namespaceOf(name: string, attributes: string, parent: string | undefined): string {
  const inForeign = parent?.toLowerCase() === 'foreignobject'
  const space = inForeign ? XHTML : FOREIGN_ROOTS[name.toLowerCase()]
  return space && !/\sxmlns=/.test(attributes) ? ` xmlns="${space}"` : ''
}

export function toXhtml(html: string): string {
  const open: string[] = []
  let foreign = 0
  let out = ''

  const renamed = (name: string) => (foreign > 0 && name.toLowerCase() === 'p' ? 'span' : name)

  for (const piece of piecesOf(legalXml(html))) {
    switch (piece.kind) {
      case 'text':
        out += escaped(piece.text, false)
        break

      case 'comment':
        if (!piece.text.includes('--') && !piece.text.endsWith('-')) {
          out += `<!--${piece.text}-->`
        }
        break

      case 'open': {
        const attributes = attributesOf(piece.attributes)
        const name = renamed(piece.name)
        const space = namespaceOf(name, attributes, open.at(-1))

        if (piece.empty || VOID_ELEMENTS.has(name.toLowerCase())) {
          out += `<${name}${space}${attributes} />`
        } else {
          if (name.toLowerCase() === 'foreignobject') foreign++
          out += `<${name}${space}${attributes}>`
          open.push(name)
        }
        break
      }

      case 'close': {
        const name = renamed(piece.name)
        out += closing(open, name)
        if (piece.name.toLowerCase() === 'foreignobject' && foreign > 0) foreign--
        break
      }
    }
  }

  return out + closing(open, null)
}

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

  return cut.length ? cut : ['']
}

const FOOTNOTES = /<section class="footnotes">[\s\S]*?<\/section>/

function withoutFootnotes(xhtml: string): { body: string; footnotes: string } {
  const found = FOOTNOTES.exec(xhtml)
  if (!found) return { body: xhtml, footnotes: '' }

  const body = xhtml.slice(0, found.index) + xhtml.slice(found.index + found[0].length)
  return { body, footnotes: found[0] }
}

function sectionFile(index: number): string {
  return `section-${index + 1}.xhtml`
}

function placesOf(sections: readonly string[]): Map<string, number> {
  const places = new Map<string, number>()

  sections.forEach((section, index) => {
    for (const [, id] of section.matchAll(/\sid="([^"]*)"/g)) {
      if (id !== undefined && !places.has(id)) places.set(id, index)
    }
  })

  return places
}

function withCrossLinks(sections: readonly string[]): string[] {
  const places = placesOf(sections)

  return sections.map((section, index) =>
    section.replace(/href="#([^"]*)"/g, (whole: string, id: string) => {
      const place = places.get(id)
      return place === undefined || place === index ? whole : `href="${sectionFile(place)}#${id}"`
    }),
  )
}

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

interface Part {
  file: string
  title: string
  marks: Mark[]
}

function partOf(section: string, index: number, level: number, bookTitle: string): Part {
  let title: string | null = null
  const marks: Mark[] = []

  for (const [, depth, attributes, inner] of section.matchAll(HEADING)) {
    const words = textOf(inner ?? '')
    const id = /\sid="([^"]*)"/.exec(attributes ?? '')?.[1]

    if (Number(depth) <= level && title === null) title = words
    else if (Number(depth) === level + 1 && id) marks.push({ title: words, id })
  }

  return { file: sectionFile(index), title: title ?? bookTitle, marks }
}

interface Image {
  src: string
  id: string
  path: string
  href: string
  type: string
  bytes: Uint8Array
}

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

function withRewrittenSources(html: string, images: readonly Image[]): string {
  if (!images.length) return html

  const inside = new Map<string, string>()
  for (const image of images) {
    inside.set(image.src, `../${image.href}`)
    inside.set(image.src.replace(/&/g, '&amp;'), `../${image.href}`)
  }

  return mapSources(html, (src) => inside.get(src) ?? null)
}

function instantOf(iso: string): string {
  const when = new Date(iso)
  const at = Number.isNaN(when.getTime()) ? new Date() : when
  return `${at.toISOString().slice(0, 19)}Z`
}

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

function ncxDocument(options: EpubOptions, parts: readonly Part[]): string {
  const point = (order: number, title: string, src: string, nested: string): string =>
    `<navPoint id="navpoint-${order}" playOrder="${order}"><navLabel><text>${escaped(title, false)}</text></navLabel><content src="${src}" />${nested}</navPoint>`

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
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
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

export function forReading(css: string): string {
  let out = ''
  let at = 0

  for (;;) {
    const start = css.indexOf('@media print', at)
    if (start < 0) return out + css.slice(at)

    const opened = css.indexOf('{', start)
    if (opened < 0) return out + css.slice(at)

    let depth = 1
    let scan = opened + 1
    while (scan < css.length && depth > 0) {
      const character = css[scan]
      if (character === '{') depth++
      else if (character === '}') depth--
      scan++
    }

    out += css.slice(at, start)
    at = scan
  }
}

interface ManifestItem {
  id: string
  href: string
  type: string
  nav?: boolean
  svg?: boolean
}

function packageDocument(
  options: EpubOptions,
  items: readonly ManifestItem[],
  spine: readonly string[],
): string {
  const manifest = items
    .map((item) => {
      const properties = [item.nav ? 'nav' : '', item.svg ? 'svg' : ''].filter(Boolean).join(' ')
      const declared = properties ? ` properties="${properties}"` : ''

      return `<item id="${item.id}" href="${item.href}" media-type="${escaped(item.type, true)}"${declared} />`
    })
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
      ...((sections[index] ?? '').includes('<svg') ? { svg: true } : {}),
    })),
    ...images.map((image) => ({ id: image.id, href: image.href, type: image.type })),
  ]

  const entries: Entry[] = [
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
    { path: `OEBPS/${STYLESHEET}`, body: forReading(options.css) },
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
