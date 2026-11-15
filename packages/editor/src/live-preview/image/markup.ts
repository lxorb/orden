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
  size?: string
}

export interface ImageSpan extends ImageSpec {
  from: number
  to: number
  tag?: { from: number; to: number }
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
  const match = new RegExp(`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  const value = match?.[1] ?? match?.[2]
  return value === undefined ? undefined : unescapeAttr(value)
}

export function parseHtmlImage(tag: string): ImageSpec | null {
  if (!/<img\b/i.test(tag)) return null
  const src = attribute(tag, 'src')
  if (!src) return null

  const zoom = /zoom\s*:\s*(\d+(?:\.\d+)?)\s*%/i.exec(tag)
  const width = /(?<![\w-])width\s*=\s*["']?(\d+)/i.exec(tag)

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
  return alt.replace(/[\\[\]]/g, '\\$&')
}

function readAlt(written: string): string {
  return written.replace(/\\([\\[\]])/g, '$1')
}

function writtenTitle(title: string): string {
  return `"${title.replace(/[\\"]/g, '\\$&')}"`
}

function readTitle(written: string): string {
  return written.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

function parseMarkdownImage(state: EditorState, node: SyntaxNode): ImageSpec | null {
  const url = node.getChild('URL')
  if (!url) return null

  const [open, close] = node.getChildren('LinkMark')
  const between = open && close ? state.doc.sliceString(open.to, close.from) : ''
  const { alt: written, size } = sizedAlt(between)
  const alt = readAlt(written)
  const title = node.getChild('LinkTitle')

  return {
    src: bareAddress(state.doc.sliceString(url.from, url.to)),
    alt,
    title: title ? readTitle(state.doc.sliceString(title.from + 1, title.to - 1)) : '',
    zoom: 100,
    ...(size ? { width: size.width, size: between.slice(written.length) } : {}),
  }
}

const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
const ANY_TAG = /<\/?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi
const BLANK = /&nbsp;|&#160;|&#xa0;/gi

function htmlImageIn(state: EditorState, node: SyntaxNode): ImageSpan | null {
  const written = state.doc.sliceString(node.from, node.to)
  const tags = [...written.matchAll(IMG_TAG)]
  const [tag] = tags
  if (!tag || tags.length > 1 || written.replace(ANY_TAG, '').replace(BLANK, ' ').trim())
    return null

  const spec = parseHtmlImage(tag[0])
  const from = node.from + tag.index
  const whole = from === node.from && from + tag[0].length === node.to
  return (
    spec && {
      ...spec,
      from: node.from,
      to: node.to,
      ...(whole ? {} : { tag: { from, to: from + tag[0].length } }),
    }
  )
}

export function imageOfNode(state: EditorState, node: SyntaxNode): ImageSpan | null {
  if (node.name !== 'Image') return IMAGE_NODES.has(node.name) ? htmlImageIn(state, node) : null

  const spec = parseMarkdownImage(state, node)
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

export function imageMarkup(spec: ImageSpec, asTag = false): string {
  const zoomed = spec.zoom !== 100
  const sized = spec.width ? (spec.size ?? '') : ''
  if (!zoomed && (!spec.width || sized) && !asTag) {
    return `![${writtenAlt(spec.alt)}${sized}](${writtenAddress(spec.src)}${spec.title ? ` ${writtenTitle(spec.title)}` : ''})`
  }

  const attrs = [`src="${attributeValue(spec.src)}"`, `alt="${attributeValue(spec.alt)}"`]
  if (spec.title) attrs.push(`title="${attributeValue(spec.title)}"`)
  if (zoomed) attrs.push(`style="zoom:${spec.zoom}%;"`)
  else if (spec.width) attrs.push(`width="${spec.width}"`)
  return `<img ${attrs.join(' ')} />`
}

function attributeAt(tag: string, name: string): RegExpExecArray | null {
  return new RegExp(`(\\s)${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i').exec(tag)
}

function withAttribute(tag: string, name: string, value: string | null): string {
  const found = attributeAt(tag, name)
  const after = found ? tag.slice(found.index + found[0].length) : ''
  if (value === null) return found ? tag.slice(0, found.index) + after : tag

  const written = `${name}="${attributeValue(value)}"`
  if (found) return `${tag.slice(0, found.index)}${found[1] ?? ' '}${written}${after}`

  const end = /\s*\/?>$/.exec(tag)
  const at = end ? end.index : tag.length
  return `${tag.slice(0, at)} ${written}${tag.slice(at)}`
}

function withZoomStyle(tag: string, zoom: number): string {
  const rest = (attribute(tag, 'style') ?? '').replace(/zoom\s*:\s*[^;]*;?\s*/i, '').trim()
  const style = zoom === 100 ? rest : `zoom:${zoom}%;${rest ? ` ${rest}` : ''}`
  return withAttribute(tag, 'style', style || null)
}

export function retag(tag: string, spec: ImageSpec): string {
  let written = withAttribute(tag, 'src', spec.src)
  written = withAttribute(written, 'alt', spec.alt || (attributeAt(tag, 'alt') ? '' : null))
  written = withAttribute(written, 'title', spec.title || null)
  written = withZoomStyle(written, spec.zoom)
  const width = spec.zoom === 100 && spec.width ? String(spec.width) : null
  return withAttribute(written, 'width', width)
}

export function sourceCaret(state: EditorState, image: ImageSpan): number {
  const text = state.doc.sliceString(image.from, image.to)
  if (text.startsWith('![')) return image.from + 2 + writtenAlt(image.alt).length

  const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(text)
  return alt ? image.from + alt.index + alt[0].length - 1 : image.from + 1
}
