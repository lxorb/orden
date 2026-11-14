export interface Element {
  name: string
  attributes: Record<string, string>
  inner: string
}

export interface Tag {
  name: string
  attributes: Record<string, string>
  from: number
  to: number
  closing: boolean
  empty: boolean
}

const CDATA = '<![CDATA['
const CDATA_END = ']]>'

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

export function textOf(xml: string, name: string): string | null {
  const found = element(xml, name)
  return found === null ? null : plainText(found.inner)
}

export function textsOf(xml: string, name: string): string[] {
  return elements(xml, name).map((one) => plainText(one.inner))
}

export function plainText(inner: string): string {
  let out = ''
  let at = 0

  while (at < inner.length) {
    const open = inner.indexOf(CDATA, at)
    if (open < 0) {
      out += unescapeXml(inner.slice(at))
      break
    }

    out += unescapeXml(inner.slice(at, open))
    const close = inner.indexOf(CDATA_END, open + CDATA.length)
    if (close < 0) {
      out += inner.slice(open + CDATA.length)
      break
    }

    out += inner.slice(open + CDATA.length, close)
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

export function closingOf(xml: string, name: string, after: number): number {
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
