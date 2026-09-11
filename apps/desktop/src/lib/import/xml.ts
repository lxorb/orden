/** Enough XML to read an export out of, and no more.
 *
 *  Two of these formats are XML: an Evernote `.enex` and a Tomboy `.note`. Both
 *  are a list of records with named fields, which is the one thing this answers:
 *  "the elements called this, in order, with what is between their tags".
 *
 *  A scan rather than a tree, for two reasons. An `.enex` of a real archive is
 *  hundreds of megabytes, and building a node per element would cost several
 *  times that in a webview that also has an app in it. And the interesting part
 *  of a note is inside CDATA, which is markup to be handed to the markdown
 *  converter rather than markup to be walked.
 *
 *  Not a parser: nothing here validates, and a document that is not well formed
 *  reads as far as it makes sense. An export that a machine wrote is either
 *  well formed or beyond helping, and refusing to read 5,000 notes because one
 *  of them has a stray ampersand in it would be the wrong answer. */

export interface Element {
  name: string
  attributes: Record<string, string>
  /** Everything between the tags, exactly as written. */
  inner: string
}

export interface Tag {
  name: string
  attributes: Record<string, string>
  /** Where the `<` is, and where the character after the `>` is. */
  from: number
  to: number
  closing: boolean
  /** A tag that closes itself, so it has no inner text at all. */
  empty: boolean
}

const CDATA = '<![CDATA['
const CDATA_END = ']]>'

/** Every `<name>` element at the shallowest depth it appears, in order.
 *
 *  Nesting of the same name is counted, so asking a Tomboy note for its
 *  `list-item` elements answers with the outer ones and their own inner ones as
 *  part of the text. Which is what a caller that walks them itself wants. */
export function elements(xml: string, name: string): Element[] {
  const found: Element[] = []
  let depth = 0
  let attributes: Record<string, string> = {}
  let from = 0

  for (const tag of tagsIn(xml)) {
    if (tag.name !== name) continue

    if (tag.empty) {
      if (depth === 0) found.push({ name, attributes: tag.attributes, inner: '' })
      continue
    }

    if (!tag.closing) {
      if (depth === 0) {
        attributes = tag.attributes
        from = tag.to
      }
      depth += 1
      continue
    }

    if (depth === 0) continue
    depth -= 1
    if (depth === 0) found.push({ name, attributes, inner: xml.slice(from, tag.from) })
  }

  return found
}

/** The first `<name>` element, or null. */
export function element(xml: string, name: string): Element | null {
  for (const tag of tagsIn(xml)) {
    if (tag.name !== name) continue
    if (tag.empty) return { name, attributes: tag.attributes, inner: '' }
    if (tag.closing) continue

    const end = closingOf(xml, name, tag.to)
    return { name, attributes: tag.attributes, inner: xml.slice(tag.to, end) }
  }

  return null
}

/** What the first `<name>` element says, as words: entities resolved, CDATA
 *  unwrapped, nothing else touched. Null when there is no such element, which is
 *  different from one that is empty. */
export function textOf(xml: string, name: string): string | null {
  const found = element(xml, name)
  return found === null ? null : plainText(found.inner)
}

/** Every `<name>` element's text. */
export function textsOf(xml: string, name: string): string[] {
  return elements(xml, name).map((one) => plainText(one.inner))
}

/** CDATA unwrapped and entities resolved, which is what a field holds. */
export function plainText(inner: string): string {
  return unescapeXml(withoutCdata(inner))
}

export function withoutCdata(text: string): string {
  let out = ''
  let at = 0

  while (at < text.length) {
    const open = text.indexOf(CDATA, at)
    if (open < 0) {
      out += text.slice(at)
      break
    }

    out += text.slice(at, open)
    const close = text.indexOf(CDATA_END, open + CDATA.length)
    if (close < 0) {
      // Unterminated, so the rest of the document is the section's contents.
      out += text.slice(open + CDATA.length)
      break
    }

    out += text.slice(open + CDATA.length, close)
    at = close + CDATA_END.length
  }

  return out
}

const NAMED: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** The five entities XML defines, the one HTML adds that every exporter uses
 *  anyway, and numbers. Anything else is left as written: an unknown entity is a
 *  fact about the file, and guessing at it would change what the note says. */
export function unescapeXml(text: string): string {
  if (!text.includes('&')) return text

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const said = body.toLowerCase()
    const named = NAMED[said]
    if (named !== undefined) return named

    if (said.startsWith('#x')) return codePoint(Number.parseInt(said.slice(2), 16)) ?? whole
    if (said.startsWith('#')) return codePoint(Number.parseInt(said.slice(1), 10)) ?? whole
    return whole
  })
}

function codePoint(value: number): string | null {
  if (!Number.isFinite(value) || value < 1 || value > 0x10ffff) return null
  try {
    return String.fromCodePoint(value)
  } catch {
    return null
  }
}

/** Where the tag that closes this one starts, counting nesting, or the end of
 *  the document when nothing closes it. */
function closingOf(xml: string, name: string, after: number): number {
  let depth = 1

  for (const tag of tagsIn(xml, after)) {
    if (tag.name !== name || tag.empty) continue
    if (tag.closing) {
      depth -= 1
      if (depth === 0) return tag.from
    } else depth += 1
  }

  return xml.length
}

/** Every tag in the document, in order, with comments, declarations,
 *  instructions and CDATA sections stepped over.
 *
 *  Exported because one format is read by walking its tags rather than by asking
 *  for them: a Tomboy note's words are the text between its tags, and the tags
 *  are what say whether those words are bold or an item of a list. */
export function* tagsIn(xml: string, from = 0): Generator<Tag> {
  let at = from

  while (at < xml.length) {
    const open = xml.indexOf('<', at)
    if (open < 0) return

    if (xml.startsWith(CDATA, open)) {
      const close = xml.indexOf(CDATA_END, open)
      at = close < 0 ? xml.length : close + CDATA_END.length
      continue
    }

    if (xml.startsWith('<!--', open)) {
      const close = xml.indexOf('-->', open)
      at = close < 0 ? xml.length : close + 3
      continue
    }

    if (xml.startsWith('<!', open) || xml.startsWith('<?', open)) {
      const close = xml.indexOf('>', open)
      at = close < 0 ? xml.length : close + 1
      continue
    }

    const close = tagEnd(xml, open)
    if (close < 0) return

    const tag = tagAt(xml, open, close)
    at = close + 1
    if (tag) yield tag
  }
}

/** Where the `>` of the tag starting at `open` is, with quoted attribute values
 *  stepped over so a `>` inside one does not end the tag. */
function tagEnd(xml: string, open: number): number {
  let quote = ''

  for (let at = open + 1; at < xml.length; at += 1) {
    const one = xml[at]
    if (quote) {
      if (one === quote) quote = ''
      continue
    }

    if (one === '"' || one === "'") quote = one
    else if (one === '>') return at
  }

  return -1
}

const NAME = /^<\/?([A-Za-z_:][A-Za-z0-9_:.-]*)/
const ATTRIBUTE = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g

function tagAt(xml: string, open: number, close: number): Tag | null {
  const whole = xml.slice(open, close + 1)
  const name = NAME.exec(whole)?.[1]
  if (!name) return null

  const closing = whole.startsWith('</')
  const empty = whole.endsWith('/>')
  const attributes: Record<string, string> = {}

  if (!closing) {
    for (const found of whole.matchAll(ATTRIBUTE)) {
      const key = found[1]
      const value = found[3] ?? found[4] ?? ''
      if (key) attributes[key] = unescapeXml(value)
    }
  }

  return { name, attributes, from: open, to: close + 1, closing, empty }
}
