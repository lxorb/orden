const REFERENCE = /&(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/y
const CLOSE_TAG = /<\/([^\s>]+)\s*>/y
const OPEN_TAG = /<([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/y
const ATTRIBUTE = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g

function strayReference(text: string): string | null {
  for (let at = text.indexOf('&'); at >= 0; at = text.indexOf('&', at + 1)) {
    REFERENCE.lastIndex = at
    if (!REFERENCE.test(text)) return `a bare & at ${JSON.stringify(text.slice(at, at + 24))}`
  }

  return null
}

function badAttributes(source: string): string | null {
  const seen = new Set<string>()

  for (const found of source.matchAll(ATTRIBUTE)) {
    const name = found[1] ?? ''
    const value = found[2]

    if (value === undefined) return `the bare attribute ${name}`
    if (!value.startsWith('"')) return `an unquoted value on ${name}`
    if (seen.has(name)) return `${name} written twice`
    seen.add(name)

    const stray = strayReference(value)
    if (stray) return `${stray} in ${name}`
  }

  return source.replace(ATTRIBUTE, '').trim() === ''
    ? null
    : `something that is not an attribute in ${JSON.stringify(source)}`
}

export function malformed(xml: string): string | null {
  const open: string[] = []
  let at = 0

  while (at < xml.length) {
    const next = xml.indexOf('<', at)
    const stray = strayReference(xml.slice(at, next < 0 ? xml.length : next))
    if (stray) return stray
    if (next < 0) break

    if (xml.startsWith('<!--', next)) {
      const end = xml.indexOf('-->', next + 4)
      if (end < 0) return 'a comment that never ends'

      const inner = xml.slice(next + 4, end)
      if (inner.includes('--') || inner.endsWith('-')) return `a comment XML forbids: ${inner}`
      at = end + 3
      continue
    }

    if (xml.startsWith('<!', next) || xml.startsWith('<?', next)) {
      const end = xml.indexOf('>', next)
      if (end < 0) return 'a declaration that never ends'
      at = end + 1
      continue
    }

    CLOSE_TAG.lastIndex = next
    const close = CLOSE_TAG.exec(xml)
    if (close) {
      const name = close[1] ?? ''
      if (open.pop() !== name) return `</${name}> closes nothing that is open`
      at = CLOSE_TAG.lastIndex
      continue
    }

    OPEN_TAG.lastIndex = next
    const found = OPEN_TAG.exec(xml)
    const name = found?.[1]
    if (name === undefined) {
      return `a < that starts no tag: ${JSON.stringify(xml.slice(next, next + 40))}`
    }

    const bad = badAttributes(found?.[2] ?? '')
    if (bad) return `${bad} on <${name}>`
    if (found?.[3] !== '/') open.push(name)
    at = OPEN_TAG.lastIndex
  }

  return open.length ? `<${open.join('>, <')}> never closed` : null
}
