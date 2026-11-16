import type { SyntaxNode } from '@lezer/common'
import { ordenMarkdownParser } from '../markdown/extensions'
import { bareHref, linkDestination } from '../links'
import { linkAddress } from '../nodes'

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
  'LinkTitle',
  'WikilinkMark',
])

const SAFE_URL = /^(https?:\/\/|mailto:|#|\/|\.)/i

export type Inline = { text: string } | { tag: string; href?: string; children: Inline[] }

function address(shown: Inline, holder: SyntaxNode): Inline {
  const written = 'text' in shown ? shown.text : ''
  if ((holder.name === 'Link' || holder.name === 'Image') && linkAddress(holder)) {
    return shown
  }
  const linked = bareHref(written)
  const href = /^www\./i.test(linked) ? `https://${linked}` : linked
  return SAFE_URL.test(href) ? { tag: 'a', href, children: [shown] } : shown
}

interface Written {
  text: string
  at: number
}

function walked(source: string, texts?: Written[]): Inline[] {
  if (!source) return []

  const top = ordenMarkdownParser.parse(source).topNode
  const paragraph = top.firstChild ?? top

  return walk(paragraph, source, paragraph.from, paragraph.to, false, texts)
}

export function parseInline(source: string): Inline[] {
  return walked(source)
}

export function sourceOffset(source: string, shown: number): number {
  const texts: Written[] = []
  walked(source, texts)
  let passed = 0
  for (const one of texts) {
    if (shown <= passed + one.text.length) return one.at + (shown - passed)
    passed += one.text.length
  }
  return source.length
}

export function renderInline(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  build(fragment, parseInline(source))
  return fragment
}

function walk(
  node: SyntaxNode,
  source: string,
  from: number,
  to: number,
  bracketed = false,
  texts?: Written[],
): Inline[] {
  const out: Inline[] = []
  let at = from
  const words = (text: string, start: number): Inline => {
    texts?.push({ text, at: start })
    return { text }
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from >= to) break
    if (child.to <= at) continue

    if (child.from > at) out.push(words(source.slice(at, child.from), at))

    if (child.name === 'Escape') {
      out.push(words(source.slice(child.from + 1, child.to), child.from + 1))
    } else if (child.name === 'InlineCode') {
      const code = codeText(child, source)
      out.push({ tag: 'code', children: [words(code.text, code.from)] })
    } else if (child.name === 'URL') {
      if (linkAddress(node)?.from !== child.from)
        out.push(address(words(source.slice(child.from, child.to), child.from), node))
    } else if (bracketed && child.name === 'LinkMark') {
      out.push(words(source.slice(child.from, child.to), child.from))
    } else if (child.name === 'Link' && !linkAddress(child)) {
      out.push(...walk(child, source, child.from, child.to, true, texts))
    } else if (!HIDDEN.has(child.name)) {
      const children = walk(child, source, child.from, child.to, false, texts)
      const tag = TAGS[child.name]

      if (child.name === 'Link') {
        const url = linkAddress(child)
        const href = url ? linkDestination(source.slice(url.from, url.to)) : ''
        out.push(SAFE_URL.test(href) ? { tag: 'a', href, children } : { tag: 'a', children })
      } else if (tag) {
        out.push({ tag, children })
      } else {
        out.push(...children)
      }
    }

    at = child.to
  }

  if (at < to) out.push(words(source.slice(at, to), at))
  return out
}

function codeText(node: SyntaxNode, source: string): { text: string; from: number } {
  let from = node.from
  let to = node.to

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'CodeMark') continue
    if (child.from === from) from = child.to
    if (child.to === to) to = child.from
  }

  return { text: source.slice(from, to).replace(/\\\|/g, '|'), from }
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
