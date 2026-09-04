import type { SyntaxNode } from '@lezer/common'
import { GFM, parser } from '@lezer/markdown'
import { nibMarkdownExtensions } from '../markdown/extensions'

/** The same grammar the document is parsed with, so a cell agrees with the
 *  prose around it rather than having a dialect of its own. */
const cellParser = parser.configure([GFM, ...nibMarkdownExtensions])

/** Which inline construct becomes which element. Anything absent keeps its
 *  text and loses only its wrapper, so an unknown node degrades to plain
 *  words rather than disappearing. */
const TAGS: Record<string, string> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  InlineCode: 'code',
  Strikethrough: 'del',
  Highlight: 'mark',
  Superscript: 'sup',
  Subscript: 'sub',
}

/** Syntax rather than content. Hiding these is the whole of rendering. */
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
])

/** Schemes that cannot execute anything. Cell text is whatever someone typed,
 *  and it lands in the editor's own document. */
const SAFE_URL = /^(https?:\/\/|mailto:|#|\/|\.)/i

/** A rendered cell, before it is any particular kind of node. Keeping the shape
 *  separate from the DOM is what lets the parsing be tested on its own. */
export type Inline = { text: string } | { tag: string; href?: string; children: Inline[] }

/** A table cell's markdown as a shape. One line of inline content: a cell
 *  cannot hold a heading or a list, so only the inline grammar applies. */
export function parseInline(source: string): Inline[] {
  if (!source) return []

  // Everything inline sits under a single Paragraph.
  const top = cellParser.parse(source).topNode
  const paragraph = top.firstChild ?? top

  return walk(paragraph, source, paragraph.from, paragraph.to)
}

/** The same cell as elements, ready to go into the table. */
export function renderInline(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  build(fragment, parseInline(source))
  return fragment
}

/** Reads `from`..`to` of the source, wrapping the inline nodes it meets on the
 *  way and dropping the marks that spell them. */
function walk(node: SyntaxNode, source: string, from: number, to: number): Inline[] {
  const out: Inline[] = []
  let at = from

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from >= to) break
    if (child.to <= at) continue

    // Whatever sits between the previous node and this one is plain text.
    if (child.from > at) out.push({ text: source.slice(at, child.from) })

    if (child.name === 'Escape') {
      // The backslash is syntax; the character it protects is the content.
      out.push({ text: source.slice(child.from + 1, child.to) })
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
        // Unknown wrapper: keep what is inside it, drop the wrapper itself.
        out.push(...children)
      }
    }

    at = child.to
  }

  if (at < to) out.push({ text: source.slice(at, to) })
  return out
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
