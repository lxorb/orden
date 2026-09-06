import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** Reading an image out of the document and writing one back.
 *
 *  A picture is written two ways. Plain markdown says everything a picture
 *  without a size needs, and is what the note holds while it has none; a resized
 *  picture becomes the `<img>` tag Typora writes, because markdown has no way to
 *  say how big something is. Both are read here and both come back out of
 *  `imageMarkup`, which picks whichever can say what the spec holds. */

export interface ImageSpec {
  src: string
  alt: string
  /** The `"title"` after the path, or an `<img>` tag's title attribute. */
  title: string
  /** Percentage of natural width, as Typora's `style="zoom:N%"` stores it. */
  zoom: number
  /** A `width` attribute, in pixels. Kept until the image is resized here. */
  width?: number
}

/** An image and where it is in the document. */
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

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  const value = match?.[1] ?? match?.[2]
  return value === undefined ? undefined : unescapeAttr(value)
}

/** What an `<img>` tag says, or null for any other HTML. */
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
  // A zoom is what this editor writes, so it wins: an old tag carrying both
  // would otherwise be shown at one size and written back at the other.
  if (!zoom && width?.[1] !== undefined) spec.width = Number(width[1])
  return spec
}

/** The same image at a new zoom, with any pixel `width` dropped. The two are
 *  different ways of saying one thing, and a resize records the zoom, so
 *  leaving the old width behind would make the markup contradict itself. */
export function withZoom(image: ImageSpec, zoom: number): ImageSpec {
  return { src: image.src, alt: image.alt, title: image.title, zoom }
}

function parseMarkdownImage(state: EditorState, node: SyntaxNode): ImageSpec | null {
  const url = node.getChild('URL')
  if (!url) return null

  // The parser leaves alt text as bare text between `![` and `]`.
  const [open, close] = node.getChildren('LinkMark')
  const alt = open && close ? state.doc.sliceString(open.to, close.from) : ''
  const title = node.getChild('LinkTitle')

  return {
    src: state.doc.sliceString(url.from, url.to),
    alt,
    title: title ? state.doc.sliceString(title.from + 1, title.to - 1) : '',
    zoom: 100,
  }
}

/** The image a syntax node describes, if it is one. */
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
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
    node;
    node = node.parent
  ) {
    if (IMAGE_NODES.has(node.name) && (side > 0 ? node.from : node.to) === pos) return node
  }
  return null
}

/** The image starting exactly at `pos`. */
export function imageAt(state: EditorState, pos: number): ImageSpan | null {
  const node = imageNode(state, pos, 1)
  return node && imageOfNode(state, node)
}

/** The image ending exactly at `pos`. */
export function imageEndingAt(state: EditorState, pos: number): ImageSpan | null {
  const node = imageNode(state, pos, -1)
  return node && imageOfNode(state, node)
}

/** The markup for an image: markdown when nothing but markdown can say it,
 *  otherwise the `<img>` tag Typora writes. */
export function imageMarkup(spec: ImageSpec): string {
  const zoomed = spec.zoom !== 100
  if (!zoomed && !spec.width) {
    return `![${spec.alt}](${spec.src}${spec.title ? ` "${spec.title}"` : ''})`
  }

  const attrs = [`src="${escapeAttr(spec.src)}"`, `alt="${escapeAttr(spec.alt)}"`]
  if (spec.title) attrs.push(`title="${escapeAttr(spec.title)}"`)
  if (zoomed) attrs.push(`style="zoom:${spec.zoom}%;"`)
  else attrs.push(`width="${spec.width}"`)
  return `<img ${attrs.join(' ')} />`
}

/** Where the caret goes to edit the markup: right after the alt text, which is
 *  the part most worth changing by hand. */
export function sourceCaret(state: EditorState, image: ImageSpan): number {
  const text = state.doc.sliceString(image.from, image.to)
  if (text.startsWith('![')) return image.from + 2 + image.alt.length

  const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(text)
  return alt ? image.from + alt.index + alt[0].length - 1 : image.from + 1
}
