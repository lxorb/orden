import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { sizedAlt } from '@orden/markdown/links'
import { attributeValue } from '../../attributes'
import { enclosing } from '../../nodes'

export interface ImageSpec {
  src: string
  alt: string
  title: string
  zoom: number
  width?: number
}

export interface ImageSpan extends ImageSpec {
  from: number
  to: number
}

const IMAGE_NODES = new Set(['Image', 'HTMLTag', 'HTMLBlock'])

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  const value = match?.[1] ?? match?.[2]
  return value === undefined ? undefined : unescapeAttr(value)
}

export function parseHtmlImage(tag: string): ImageSpec | null {
  if (!/<img\b/i.test(tag)) return null
  const src = attribute(tag, 'src')
  if (!src) return null

  const zoom = /zoom\s*:\s*(\d+(?:\.\d+)?)\s*%/i.exec(tag)
  const width = /\bwidth\s*=\s*["']?(\d+)/i.exec(tag)

  const spec: ImageSpec = {
    src,
    alt: attribute(tag, 'alt') ?? '',
    title: attribute(tag, 'title') ?? '',
    zoom: zoom?.[1] === undefined ? 100 : Number(zoom[1]),
  }
  if (!zoom && width?.[1] !== undefined) spec.width = Number(width[1])
  return spec
}

export function withZoom(image: ImageSpec, zoom: number): ImageSpec {
  return { src: image.src, alt: image.alt, title: image.title, zoom }
}

function bareAddress(url: string): string {
  return url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url
}

function writtenAddress(src: string): string {
  return /[\s<>()]/.test(src) ? `<${src}>` : src
}

function writtenAlt(alt: string): string {
  return alt.replace(/[[\]]/g, '\\$&')
}

function readAlt(written: string): string {
  return written.replace(/\\([[\]])/g, '$1')
}

function parseMarkdownImage(state: EditorState, node: SyntaxNode): ImageSpec | null {
  const url = node.getChild('URL')
  if (!url) return null

  const [open, close] = node.getChildren('LinkMark')
  const { alt: written, size } = sizedAlt(
    open && close ? state.doc.sliceString(open.to, close.from) : '',
  )
  const alt = readAlt(written)
  const title = node.getChild('LinkTitle')

  return {
    src: bareAddress(state.doc.sliceString(url.from, url.to)),
    alt,
    title: title ? state.doc.sliceString(title.from + 1, title.to - 1) : '',
    zoom: 100,
    ...(size ? { width: size.width } : {}),
  }
}

export function imageOfNode(state: EditorState, node: SyntaxNode): ImageSpan | null {
  const spec =
    node.name === 'Image'
      ? parseMarkdownImage(state, node)
      : IMAGE_NODES.has(node.name)
        ? parseHtmlImage(state.doc.sliceString(node.from, node.to))
        : null
  return spec && { ...spec, from: node.from, to: node.to }
}

function imageNode(state: EditorState, pos: number, side: -1 | 1): SyntaxNode | null {
  for (const node of enclosing(syntaxTree(state).resolveInner(pos, side))) {
    if (IMAGE_NODES.has(node.name) && (side > 0 ? node.from : node.to) === pos) return node
  }
  return null
}

export function imageAt(state: EditorState, pos: number): ImageSpan | null {
  const node = imageNode(state, pos, 1)
  return node && imageOfNode(state, node)
}

export function imageEndingAt(state: EditorState, pos: number): ImageSpan | null {
  const node = imageNode(state, pos, -1)
  return node && imageOfNode(state, node)
}

export function imageMarkup(spec: ImageSpec): string {
  const zoomed = spec.zoom !== 100
  if (!zoomed && !spec.width) {
    return `![${writtenAlt(spec.alt)}](${writtenAddress(spec.src)}${spec.title ? ` "${spec.title}"` : ''})`
  }

  const attrs = [`src="${attributeValue(spec.src)}"`, `alt="${attributeValue(spec.alt)}"`]
  if (spec.title) attrs.push(`title="${attributeValue(spec.title)}"`)
  if (zoomed) attrs.push(`style="zoom:${spec.zoom}%;"`)
  else attrs.push(`width="${spec.width}"`)
  return `<img ${attrs.join(' ')} />`
}

export function sourceCaret(state: EditorState, image: ImageSpan): number {
  const text = state.doc.sliceString(image.from, image.to)
  if (text.startsWith('![')) return image.from + 2 + writtenAlt(image.alt).length

  const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(text)
  return alt ? image.from + alt.index + alt[0].length - 1 : image.from + 1
}
