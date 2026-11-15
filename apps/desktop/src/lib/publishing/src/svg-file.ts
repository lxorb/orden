const SHAPES = new Set([
  'svg',
  'g',
  'a',
  'defs',
  'style',
  'title',
  'desc',
  'marker',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'path',
  'line',
  'polyline',
  'polygon',
  'rect',
  'circle',
  'ellipse',
  'text',
  'tspan',
  'textpath',
])

function allowed(name: string): boolean {
  const said = name.toLowerCase()
  if (said.startsWith('on')) return false

  return !['target', 'attributename', 'xlink:show', 'xlink:actuate', 'begin', 'end'].includes(said)
}

function pointsInside(value: string): boolean {
  return value.trim().startsWith('#')
}

interface Tag {
  to: number
  raw: string
  name: string
  closing: boolean
  selfClosing: boolean
  attributes: { name: string; value: string; quote: string }[]
}

function readTag(svg: string, from: number): Tag | null {
  let at = from + 1
  const closing = svg[at] === '/'
  if (closing) at += 1

  const start = at
  while (at < svg.length && /[^\s/>]/.test(svg[at] ?? '')) at += 1
  const raw = svg.slice(start, at)
  const name = raw.toLowerCase()
  if (!name) return null

  const attributes: Tag['attributes'] = []

  for (;;) {
    while (at < svg.length && /\s/.test(svg[at] ?? '')) at += 1
    const one = svg[at]
    if (one === undefined) return null

    if (one === '>') return { to: at, raw, name, closing, selfClosing: false, attributes }
    if (one === '/' && svg[at + 1] === '>') {
      return { to: at + 1, raw, name, closing, selfClosing: true, attributes }
    }

    const named = at
    while (at < svg.length && /[^\s=/>]/.test(svg[at] ?? '')) at += 1
    const said = svg.slice(named, at)
    if (!said) return null

    while (at < svg.length && /\s/.test(svg[at] ?? '')) at += 1
    if (svg[at] !== '=') {
      attributes.push({ name: said, value: '', quote: '' })
      continue
    }

    at += 1
    while (at < svg.length && /\s/.test(svg[at] ?? '')) at += 1

    const quote = svg[at] === '"' || svg[at] === "'" ? (svg[at] ?? '') : ''
    if (quote) at += 1

    const opened = at
    while (at < svg.length && (quote ? svg[at] !== quote : /[^\s>]/.test(svg[at] ?? ''))) at += 1

    attributes.push({ name: said, value: svg.slice(opened, at), quote })
    if (quote) at += 1
  }
}

function written(tag: Tag): string {
  const said = tag.attributes
    .filter((one) => allowed(one.name))
    .filter((one) => !/^(?:xlink:)?href$/i.test(one.name) || pointsInside(one.value))
    .map((one) => {
      if (!one.quote && !one.value) return one.name
      return `${one.name}="${one.value.replace(/"/g, '&quot;')}"`
    })

  return `<${tag.raw}${said.length ? ` ${said.join(' ')}` : ''}${tag.selfClosing ? '/' : ''}>`
}

function past(svg: string, tag: Tag): number {
  let at = tag.to + 1
  let depth = 1

  while (at < svg.length && depth > 0) {
    const next = svg.indexOf('<', at)
    if (next === -1) return svg.length

    const inner = readTag(svg, next)
    if (!inner) {
      at = next + 1
      continue
    }

    if (inner.name === tag.name && !inner.selfClosing) depth += inner.closing ? -1 : 1
    at = inner.to + 1
  }

  return at
}

export function shapesOnly(svg: string): string {
  let out = ''
  let at = 0

  while (at < svg.length) {
    const next = svg.indexOf('<', at)
    if (next === -1) return out + svg.slice(at)

    out += svg.slice(at, next)

    if (svg.startsWith('<!--', next)) {
      const shut = svg.indexOf('-->', next)
      at = shut === -1 ? svg.length : shut + 3
      continue
    }
    if (svg.startsWith('<![CDATA[', next)) {
      const shut = svg.indexOf(']]>', next)
      at = shut === -1 ? svg.length : shut + 3
      continue
    }
    if (svg.startsWith('<!', next) || svg.startsWith('<?', next)) {
      const shut = svg.indexOf('>', next)
      at = shut === -1 ? svg.length : shut + 1
      continue
    }

    const tag = readTag(svg, next)
    if (!tag) {
      out += svg[next] ?? ''
      at = next + 1
      continue
    }

    if (SHAPES.has(tag.name)) {
      out += tag.closing ? `</${tag.raw}>` : written(tag)
      at = tag.to + 1
      continue
    }

    at = tag.closing || tag.selfClosing ? tag.to + 1 : past(svg, tag)
  }

  return out
}
