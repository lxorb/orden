import { ImportError } from './build'

export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[name] ?? whole
  })
}

const NAME = /[A-Za-z_:][\w:.-]*/y
const ATTRIBUTE = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y

function malformed(): ImportError {
  return new ImportError('The file is not well-formed XML.')
}

export function parseXml(text: string): XmlElement {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const top: XmlElement = { name: '', attributes: {}, children: [], text: '' }
  const stack: XmlElement[] = [top]
  let at = 0
  const skipPast = (end: string): void => {
    const found = source.indexOf(end, at)
    if (found < 0) throw malformed()
    at = found + end.length
  }
  while (at < source.length) {
    const open = source.indexOf('<', at)
    const current = stack[stack.length - 1] ?? top
    if (open < 0) {
      current.text += decodeEntities(source.slice(at))
      break
    }
    if (open > at) current.text += decodeEntities(source.slice(at, open))
    at = open
    if (source.startsWith('<?', at)) {
      skipPast('?>')
    } else if (source.startsWith('<!--', at)) {
      skipPast('-->')
    } else if (source.startsWith('<![CDATA[', at)) {
      const end = source.indexOf(']]>', at)
      if (end < 0) throw malformed()
      current.text += source.slice(at + 9, end)
      at = end + 3
    } else if (source.startsWith('<!', at)) {
      skipPast('>')
    } else if (source.startsWith('</', at)) {
      NAME.lastIndex = at + 2
      const name = NAME.exec(source)?.[0]
      if (name === undefined || name !== current.name || stack.length < 2) throw malformed()
      at = NAME.lastIndex
      skipPast('>')
      stack.pop()
    } else {
      NAME.lastIndex = at + 1
      const name = NAME.exec(source)?.[0]
      if (name === undefined) throw malformed()
      at = NAME.lastIndex
      const element: XmlElement = { name, attributes: {}, children: [], text: '' }
      for (;;) {
        ATTRIBUTE.lastIndex = at
        const attribute = ATTRIBUTE.exec(source)
        if (!attribute) break
        element.attributes[attribute[1] ?? ''] = decodeEntities(attribute[2] ?? attribute[3] ?? '')
        at = ATTRIBUTE.lastIndex
      }
      const rest = /\s*(\/?)>/y
      rest.lastIndex = at
      const end = rest.exec(source)
      if (!end) throw malformed()
      at = rest.lastIndex
      current.children.push(element)
      if (end[1] !== '/') stack.push(element)
    }
  }
  const root = top.children[0]
  if (stack.length !== 1 || root === undefined || top.children.length !== 1) throw malformed()
  return root
}

export function childOf(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((one) => one.name === name)
}

export function childrenOf(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((one) => one.name === name)
}

export function textAt(element: XmlElement | undefined, ...path: string[]): string {
  let at = element
  for (const name of path) at = at === undefined ? undefined : childOf(at, name)
  return at?.text ?? ''
}
