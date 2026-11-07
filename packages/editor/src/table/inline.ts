import type { SyntaxNode } from '@lezer/common'
import { ordenMarkdownParser } from '../markdown/extensions'

const TAGS: Record<string, string> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  InlineCode: 'code',
  Strikethrough: 'del',
  Highlight: 'mark',
  Superscript: 'sup',
  Subscript: 'sub',
}

const HIDDEN = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'HighlightMark',
  'SubscriptMark',
  'SuperscriptMark',
  'LinkMark',
  'URL',
  'LinkTitle',
  'WikilinkMark',
])

const SAFE_URL = /^(https?:\/\/|mailto:|#|\/|\.)/i

export type Inline = { text: string } | { tag: string; href?: string; children: Inline[] }

export function parseInline(source: string): Inline[] {
  if (!source) return []

  const top = ordenMarkdownParser.parse(source).topNode
  const paragraph = top.firstChild ?? top

  return walk(paragraph, source, paragraph.from, paragraph.to)
}

export function renderInline(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  build(fragment, parseInline(source))
  return fragment
}

function walk(node: SyntaxNode, source: string, from: number, to: number): Inline[] {
  const out: Inline[] = []
  let at = from

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from >= to) break
    if (child.to <= at) continue

    if (child.from > at) out.push({ text: source.slice(at, child.from) })

    if (child.name === 'Escape') {
      out.push({ text: source.slice(child.from + 1, child.to) })
    } else if (child.name === 'InlineCode') {
      out.push({ tag: 'code', children: [{ text: codeText(child, source) }] })
    } else if (!HIDDEN.has(child.name)) {
      const children = walk(child, source, child.from, child.to)
      const tag = TAGS[child.name]

      if (child.name === 'Link') {
        const url = child.getChild('URL')
        const href = url ? source.slice(url.from, url.to) : ''
        out.push(SAFE_URL.test(href) ? { tag: 'a', href, children } : { tag: 'a', children })
      } else if (tag) {
        out.push({ tag, children })
      } else {
        out.push(...children)
      }
    }

    at = child.to
  }

  if (at < to) out.push({ text: source.slice(at, to) })
  return out
}

function codeText(node: SyntaxNode, source: string): string {
  let from = node.from
  let to = node.to

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'CodeMark') continue
    if (child.from === from) from = child.to
    if (child.to === to) to = child.from
  }

  return source.slice(from, to).replace(/\\\|/g, '|')
}

function build(parent: Node, nodes: Inline[]) {
  for (const node of nodes) {
    if ('text' in node) {
      parent.appendChild(document.createTextNode(node.text))
      continue
    }

    const element = document.createElement(node.tag)
    if (node.href) element.setAttribute('href', node.href)

    build(element, node.children)
    parent.appendChild(element)
  }
}
