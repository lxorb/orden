import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import {
  type Command,
  EditorView,
  type KeyBinding,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { imageResolver } from '../images'
import { label as uiLabel } from '../labels'
import { NibWidget } from './widget'

/** Images in the live preview.
 *
 *  A picture is an object in the text, not a run of characters, and it is
 *  treated as one:
 *
 *  - It stays a picture while the caret is beside it. Only a caret strictly
 *    inside the markup (`![alt](src)` or an `<img>` tag) shows the markup, and
 *    the caret only gets there on purpose: Enter on a selected image, or the
 *    toolbar's "Edit markdown". Everywhere else the preview reveals syntax as
 *    soon as the caret touches it; for an image that would collapse a
 *    400px picture into a line of text whenever an arrow key passed by.
 *  - A click selects it: the selection becomes exactly the image's range, the
 *    editor keeps focus, and the picture gets a frame, corner handles and a
 *    small toolbar. Because it is a real selection, everything the editor
 *    already knows applies: typing replaces it, Backspace and Delete remove
 *    it, Ctrl+C copies its markdown, arrow keys step off it, Shift+click
 *    extends over it.
 *  - Backspace right after a rendered image, or Delete right before one,
 *    selects it rather than deleting it, so a picture is never lost to a
 *    keystroke aimed at a character. The second press deletes.
 *  - Double click opens the lightbox, as does the toolbar's open button.
 *  - Dragging a corner resizes. The size is the width as a percentage of the
 *    image's natural width, which is what Typora stores as
 *    `style="zoom:N%"`. It snaps to quarters, thirds and full size (Alt drags
 *    freely), never exceeds 100%, and a badge shows the value while dragging.
 *    Back at 100% the markup is plain `![alt](src)` again.
 *  - The toolbar edits the alt text in place, shows and resets the size,
 *    opens the lightbox, copies the path, reveals the markdown and deletes.
 *  - A path that does not load shows the path in a placeholder, so a broken
 *    link is read rather than guessed at; the sizes of images seen once are
 *    remembered, so a picture rebuilt after an edit takes its room before it
 *    has loaded again, and nothing below it jumps.
 *
 *  Nothing here edits the DOM to change the document. Every action is a
 *  `view.dispatch` with a `userEvent` naming it (`select.image`,
 *  `input.image.resize`, `input.image.alt`, `delete.image`), and the widget
 *  extends NibWidget so its own DOM changes are never read as typing.
 *
 *  CodeMirror reuses a widget's DOM when `eq` matches, and attaches the newer
 *  widget instance to the old DOM. So handlers never remember a document
 *  position: they ask the view where their element is and read the image
 *  from the syntax tree at that moment. `eq` can then ignore positions, which
 *  keeps a picture from being rebuilt - and re-animated - whenever the text
 *  above it changes. Selection state is not part of the widget either: a view
 *  plugin marks the selected frame after each update, so clicking an image
 *  never rebuilds the toolbar that was just clicked. */

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

// ── Reading and writing the markup ──────────────────────────────────

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
    zoom: zoom ? Number(zoom[1]) : 100,
  }
  if (width && !zoom) spec.width = Number(width[1])
  return spec
}

function parseMarkdownImage(state: EditorState, node: SyntaxNode): ImageSpec | null {
  const url = node.getChild('URL')
  if (!url) return null

  // The parser leaves alt text as bare text between `![` and `]`.
  const marks = node.getChildren('LinkMark')
  const alt = marks.length >= 2 ? state.doc.sliceString(marks[0].to, marks[1].from) : ''
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
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
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

// ── Selection ───────────────────────────────────────────────────────

const inside = (pos: number, from: number, to: number) => pos > from && pos < to

/** Only a caret strictly inside the markup reveals it; touching an end does
 *  not, and neither does a selection covering it. */
export function imageRevealed(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => inside(range.from, from, to) || inside(range.to, from, to),
  )
}

/** The image the main selection covers exactly, if that is what is selected. */
export function selectedImage(state: EditorState): ImageSpan | null {
  const range = state.selection.main
  if (range.empty) return null
  const image = imageAt(state, range.from)
  return image && image.to === range.to ? image : null
}

function selectionOver(image: ImageSpan) {
  return EditorSelection.range(image.from, image.to)
}

/** Backspace directly after a rendered image selects it: the first press
 *  shows what is about to go, the second removes it. */
export const selectImageBehind: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const image = imageEndingAt(state, range.head)
  if (!image || imageRevealed(state, image.from, image.to)) return false

  dispatch(state.update({ selection: selectionOver(image), userEvent: 'select.image' }))
  return true
}

/** Delete directly before a rendered image, likewise. */
export const selectImageAhead: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const image = imageAt(state, range.head)
  if (!image || imageRevealed(state, image.from, image.to)) return false

  dispatch(state.update({ selection: selectionOver(image), userEvent: 'select.image' }))
  return true
}

/** Enter on a selected image opens its markup, caret after the alt text. */
export const editSelectedImage: StateCommand = ({ state, dispatch }) => {
  const image = selectedImage(state)
  if (!image) return false

  dispatch(
    state.update({
      selection: EditorSelection.cursor(sourceCaret(state, image)),
      scrollIntoView: true,
      userEvent: 'select',
    }),
  )
  return true
}

/** Escape on a selected image steps off it, to just after. */
export const leaveSelectedImage: StateCommand = ({ state, dispatch }) => {
  const image = selectedImage(state)
  if (!image) return false

  dispatch(state.update({ selection: EditorSelection.cursor(image.to), userEvent: 'select' }))
  return true
}

/** Up and down from a selected image go to the line above or below, as they
 *  would from a caret beside it, rather than merely collapsing the selection. */
function stepOff(forward: boolean): Command {
  return (view) => {
    const image = selectedImage(view.state)
    if (!image) return false

    const start = EditorSelection.cursor(forward ? image.to : image.from)
    const moved = view.moveVertically(start, forward)
    view.dispatch({
      selection: EditorSelection.create([moved.head === start.head ? start : moved]),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

export const imageKeymap: KeyBinding[] = [
  { key: 'Backspace', run: selectImageBehind },
  { key: 'Delete', run: selectImageAhead },
  { key: 'Enter', run: editSelectedImage },
  { key: 'Escape', run: leaveSelectedImage },
  { key: 'ArrowUp', run: stepOff(false) },
  { key: 'ArrowDown', run: stepOff(true) },
]

// ── Sizing ──────────────────────────────────────────────────────────

/** Where a drag settles when it comes close: the sizes people mean. */
export const SNAP_STOPS = [25, 33, 50, 67, 75, 100]
const SNAP_TOLERANCE = 3
/** Narrower than this and the handles would overlap. */
const MIN_WIDTH = 48

export function snapPercent(percent: number, snap = true): number {
  if (snap) {
    for (const stop of SNAP_STOPS) {
      if (Math.abs(percent - stop) <= SNAP_TOLERANCE) return stop
    }
  }
  return Math.round(percent)
}

/** The zoom a drag asks for: the width it dragged to, as a share of the
 *  natural width, never wider than the picture is or the line allows. */
export function resizeTo(
  startWidth: number,
  delta: number,
  natural: number,
  lineWidth: number,
  snap = true,
): number {
  const max = Math.min(natural, lineWidth)
  const width = Math.min(max, Math.max(Math.min(MIN_WIDTH, max), startWidth + delta))
  return Math.max(1, Math.min(100, snapPercent((width / natural) * 100, snap)))
}

// ── The widget ──────────────────────────────────────────────────────

/** Natural sizes of images seen so far, by resolved URL, so a rebuilt widget
 *  takes its room before the picture has loaded again. */
const NATURAL = new Map<string, { width: number; height: number }>()

function displayWidth(spec: ImageSpec, natural: number | undefined): string {
  if (spec.zoom !== 100) return natural ? `${Math.round((natural * spec.zoom) / 100)}px` : `${spec.zoom}%`
  return spec.width ? `${spec.width}px` : ''
}

function sizeLabel(zoom: number, natural: number | undefined): string {
  const pixels = natural ? ` · ${Math.round((natural * zoom) / 100)}px` : ''
  return `${zoom}%${pixels}`
}

/** An icon drawn rather than written, so the buttons match in any language. */
function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 14 14')
  for (const d of paths) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    shape.setAttribute('d', d)
    svg.append(shape)
  }
  return svg
}

const ICONS = {
  open: ['M6 2.5H2.5V6', 'M8 2.5h3.5V6', 'M6 11.5H2.5V8', 'M8 11.5h3.5V8'],
  link: ['M5.5 8.5l3-3', 'M6.5 4.5l1-1a2.1 2.1 0 013 3l-1 1', 'M7.5 9.5l-1 1a2.1 2.1 0 01-3-3l1-1'],
  copied: ['M2.5 7.5l3 3 6-6'],
  source: ['M4.5 4L2 7l2.5 3', 'M9.5 4L12 7l-2.5 3'],
  trash: ['M2.5 4h9', 'M5.5 4V2.5h3V4', 'M4 4l.5 7.5h5L10 4'],
  missing: ['M2 3.5h10v7H2z', 'M4 9l2.5-3 2 2 1.5-1.5L11.5 9', 'M4.5 5.5h.01'],
}

/** Parts of the frame the handlers reach for, found once per frame. */
interface Parts {
  frame: HTMLElement
  image: HTMLImageElement
  alt: HTMLInputElement
  size: HTMLButtonElement
  badge: HTMLElement
}

function partsOf(frame: HTMLElement): Parts {
  return {
    frame,
    image: frame.querySelector('img') as HTMLImageElement,
    alt: frame.querySelector('.nib-image-alt') as HTMLInputElement,
    size: frame.querySelector('.nib-image-size') as HTMLButtonElement,
    badge: frame.querySelector('.nib-image-badge') as HTMLElement,
  }
}

/** The image this frame stands for right now, read from the document. Null
 *  for a frame the editor has already let go of. */
function imageOfFrame(view: EditorView, frame: HTMLElement): ImageSpan | null {
  if (!view.contentDOM.contains(frame)) return null
  return imageAt(view.state, view.posAtDOM(frame))
}

function select(view: EditorView, image: ImageSpan, extend = false) {
  const current = view.state.selection.main
  const selection = extend
    ? EditorSelection.range(current.anchor, current.anchor <= image.from ? image.to : image.from)
    : selectionOver(image)

  view.dispatch({ selection, userEvent: 'select.image' })
  view.focus()
}

/** Replaces an image's markup, keeping it selected if it was. */
function rewrite(view: EditorView, image: ImageSpan, next: ImageSpec, userEvent: string) {
  const insert = imageMarkup(next)
  const wasSelected = selectedImage(view.state)?.from === image.from

  view.dispatch({
    changes: { from: image.from, to: image.to, insert },
    selection: wasSelected ? EditorSelection.range(image.from, image.from + insert.length) : undefined,
    userEvent,
  })
}

/** Focus goes to the editor before the change, not after: the change takes
 *  the widget - and whatever inside it held focus - out of the DOM. */
function remove(view: EditorView, image: ImageSpan) {
  view.focus()
  view.dispatch({
    changes: { from: image.from, to: image.to, insert: '' },
    selection: EditorSelection.cursor(image.from),
    userEvent: 'delete.image',
  })
}

export class ImageWidget extends NibWidget {
  constructor(readonly spec: ImageSpec) {
    super()
  }

  eq(other: ImageWidget) {
    const a = this.spec
    const b = other.spec
    return (
      a.src === b.src && a.alt === b.alt && a.title === b.title && a.zoom === b.zoom && a.width === b.width
    )
  }

  toDOM(view: EditorView) {
    const frame = document.createElement('span')
    frame.className = 'nib-image-frame is-loading'
    frame.contentEditable = 'false'

    const box = document.createElement('span')
    box.className = 'nib-image-box'
    frame.append(box)

    const image = document.createElement('img')
    image.className = 'nib-image'
    image.draggable = false
    box.append(image)

    const missing = document.createElement('span')
    missing.className = 'nib-image-missing'
    missing.title = uiLabel('imageNotFound')
    missing.append(icon(ICONS.missing), document.createElement('span'))
    box.append(missing)

    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('span')
      handle.className = 'nib-image-handle'
      handle.dataset.corner = corner
      handle.title = uiLabel('dragToResize')
      handle.addEventListener('pointerdown', (event) => this.startResize(event, view, frame, handle))
      box.append(handle)
    }

    const badge = document.createElement('span')
    badge.className = 'nib-image-badge'
    box.append(badge)

    box.append(this.toolbar(view, frame))

    const src = view.state.facet(imageResolver)(this.spec.src)
    frame.dataset.src = src
    const known = NATURAL.get(src)
    if (known) {
      image.width = known.width
      image.height = known.height
      frame.classList.remove('is-loading')
    }

    image.addEventListener('load', () => {
      NATURAL.set(image.src, { width: image.naturalWidth, height: image.naturalHeight })
      // A picture arriving for the first time develops into view; one whose
      // size was already known simply appears where its room was kept.
      if (!known) frame.classList.add('is-fresh')
      frame.classList.remove('is-loading', 'is-broken')
      // The size is known only now, and the document may have moved on since
      // this widget was made: a newer one may have been applied to the frame.
      this.sync(frame, imageOfFrame(view, frame) ?? this.spec)
    })
    image.addEventListener('error', () => {
      frame.classList.remove('is-loading')
      frame.classList.add('is-broken')
    })

    // Selecting on press, not release, so a drag that starts on the picture
    // still leaves it selected. Focus and the native drag of an image are
    // both prevented: the editor is what should have focus, and it is told
    // so explicitly.
    frame.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.inToolbar(event)) return
      event.preventDefault()
      const current = imageOfFrame(view, frame)
      if (current) select(view, current, event.shiftKey)
    })
    frame.addEventListener('mousedown', (event) => {
      if (!this.inToolbar(event)) event.preventDefault()
    })
    frame.addEventListener('dragstart', (event) => event.preventDefault())
    box.addEventListener('dblclick', (event) => {
      if (this.inToolbar(event) || frame.classList.contains('is-broken')) return
      event.preventDefault()
      const current = imageOfFrame(view, frame)
      if (current) openLightbox(view, image.src, current.alt)
    })

    this.sync(frame, this.spec)
    image.src = src
    return frame
  }

  /** A changed alt or size is applied to the picture that is already there,
   *  rather than loading it again. A different picture is rebuilt. */
  updateDOM(frame: HTMLElement, view: EditorView): boolean {
    if (frame.dataset.src !== view.state.facet(imageResolver)(this.spec.src)) return false
    this.sync(frame, this.spec)
    return true
  }

  /** Writes what a spec says onto the frame's parts. Never asks the view
   *  where the frame is: `toDOM` runs before the view has finished building. */
  private sync(frame: HTMLElement, image: ImageSpec) {
    const parts = partsOf(frame)
    const natural = NATURAL.get(frame.dataset.src ?? '')?.width

    parts.image.alt = image.alt
    parts.image.title = image.title
    parts.image.style.width = displayWidth(image, natural)

    const missing = frame.querySelector('.nib-image-missing > span')
    if (missing) missing.textContent = image.src

    if (document.activeElement !== parts.alt) parts.alt.value = image.alt
    parts.size.textContent = sizeLabel(image.zoom, natural)
    parts.size.disabled = image.zoom === 100
    parts.size.title = image.zoom === 100 ? '' : uiLabel('resetSize')
  }

  private inToolbar(event: Event): boolean {
    return !!(event.target as Element | null)?.closest?.('.nib-image-tools')
  }

  private toolbar(view: EditorView, frame: HTMLElement): HTMLElement {
    const tools = document.createElement('span')
    tools.className = 'nib-image-tools'

    const alt = document.createElement('input')
    alt.className = 'nib-image-alt'
    alt.type = 'text'
    alt.placeholder = uiLabel('describeImage')
    alt.spellcheck = false
    alt.setAttribute('aria-label', uiLabel('describeImage'))

    const commitAlt = () => {
      const current = imageOfFrame(view, frame)
      if (!current) return
      const next = alt.value.trim()
      if (next === current.alt) return
      rewrite(view, current, { ...current, alt: next }, 'input.image.alt')
    }

    alt.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        view.focus()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        alt.value = imageOfFrame(view, frame)?.alt ?? ''
        view.focus()
      }
    })
    alt.addEventListener('blur', commitAlt)
    // The frame would otherwise take the press as a click on the picture.
    alt.addEventListener('pointerdown', (event) => event.stopPropagation())
    tools.append(alt)

    const separator = document.createElement('span')
    separator.className = 'nib-image-tools-gap'
    tools.append(separator)

    const button = (
      className: string,
      title: string,
      content: Node | string,
      action: (image: ImageSpan) => void,
    ) => {
      const control = document.createElement('button')
      control.type = 'button'
      control.className = `nib-image-tool ${className}`
      control.title = title
      control.setAttribute('aria-label', title)
      control.append(content)
      // Pressing a button must not take focus from the editor - or from the
      // alt field, whose blur would commit before the button acted. Both
      // events are cancelled: a cancelled pointerdown does not stop the
      // mousedown that follows it from focusing the button.
      control.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      control.addEventListener('mousedown', (event) => event.preventDefault())
      control.addEventListener('click', (event) => {
        event.preventDefault()
        const current = imageOfFrame(view, frame)
        if (current) action(current)
      })
      tools.append(control)
      return control
    }

    button('nib-image-size', '', '', (image) => {
      if (image.zoom !== 100 || image.width) {
        rewrite(view, image, { ...image, zoom: 100, width: undefined }, 'input.image.resize')
      }
      view.focus()
    })

    button('nib-image-open', uiLabel('openImage'), icon(ICONS.open), (image) => {
      const picture = partsOf(frame).image
      if (!frame.classList.contains('is-broken')) openLightbox(view, picture.src, image.alt)
    })

    const copy = button('nib-image-copy', uiLabel('copyLink'), icon(ICONS.link), (image) => {
      void navigator.clipboard.writeText(image.src).then(() => {
        copy.classList.add('is-copied')
        copy.title = uiLabel('copied')
        copy.replaceChildren(icon(ICONS.copied))
        window.setTimeout(() => {
          copy.classList.remove('is-copied')
          copy.title = uiLabel('copyLink')
          copy.replaceChildren(icon(ICONS.link))
        }, 1400)
      })
    })

    button('nib-image-source', uiLabel('editMarkdown'), icon(ICONS.source), (image) => {
      // Focus first, for the same reason as in `remove`.
      view.focus()
      view.dispatch({
        selection: EditorSelection.cursor(sourceCaret(view.state, image)),
        scrollIntoView: true,
        userEvent: 'select',
      })
    })

    button('nib-image-delete', uiLabel('deleteImage'), icon(ICONS.trash), (image) => remove(view, image))

    return tools
  }

  /** A corner drag. The picture follows the pointer live; the document is
   *  written once, when the pointer is released. */
  private startResize(event: PointerEvent, view: EditorView, frame: HTMLElement, handle: HTMLElement) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const image = imageOfFrame(view, frame)
    const parts = partsOf(frame)
    const natural = NATURAL.get(frame.dataset.src ?? '')?.width || parts.image.naturalWidth
    if (!image || !natural) return

    if (selectedImage(view.state)?.from !== image.from) select(view, image)

    const startX = event.clientX
    const startWidth = parts.image.getBoundingClientRect().width
    const lineWidth = frame.closest('.cm-line')?.getBoundingClientRect().width ?? natural
    // Pulling a left-hand corner outwards is a pull to the left.
    const sign = handle.dataset.corner?.endsWith('e') ? 1 : -1
    let zoom = image.zoom

    frame.classList.add('is-resizing')
    frame.dataset.corner = handle.dataset.corner
    parts.badge.textContent = sizeLabel(zoom, natural)
    // Capture keeps the drag alive past the edge of the editor. A pointer
    // that cannot be captured - a synthetic one, in a test - still drags.
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // Left uncaptured.
    }

    const move = (moved: PointerEvent) => {
      zoom = resizeTo(startWidth, sign * (moved.clientX - startX), natural, lineWidth, !moved.altKey)
      parts.image.style.width = displayWidth({ ...image, zoom, width: undefined }, natural)
      parts.badge.textContent = sizeLabel(zoom, natural)
      parts.size.textContent = sizeLabel(zoom, natural)
    }

    const finish = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      frame.classList.remove('is-resizing')
      delete frame.dataset.corner

      const current = imageOfFrame(view, frame)
      if (!current) return
      if (zoom === current.zoom && !current.width) {
        this.sync(frame, current)
        return
      }
      rewrite(view, current, { ...current, zoom, width: undefined }, 'input.image.resize')
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  ignoreEvent() {
    return true
  }
}

// ── Marking the selected picture ────────────────────────────────────

function isSelected(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from === from && range.to === to)
}

interface Mark {
  frame: HTMLElement
  selected: boolean
  flipped: boolean
  shift: number
}

/** Keeps every frame's classes in step with the selection, without rebuilding
 *  any of them. Reads happen in the measure phase and writes after it, the
 *  way the editor asks; the toolbar flips below the picture when the picture
 *  is too close to the top of the view for it to fit above. */
const imageSelection = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      this.schedule()
    }

    update(update: ViewUpdate) {
      if (
        update.selectionSet ||
        update.docChanged ||
        update.viewportChanged ||
        update.focusChanged ||
        update.geometryChanged
      ) {
        this.schedule()
      }
    }

    private schedule() {
      this.view.requestMeasure({
        key: this,
        read: () => this.read(),
        write: (marks: Mark[]) => {
          for (const { frame, selected, flipped, shift } of marks) {
            frame.classList.toggle('is-selected', selected)
            frame.classList.toggle('is-flipped', flipped)
            frame.style.setProperty('--nib-tools-shift', `${shift}px`)
          }
        },
      })
    }

    private read(): Mark[] {
      const view = this.view
      const state = view.state
      const scroller = view.scrollDOM.getBoundingClientRect()
      const out: Mark[] = []

      for (const frame of view.contentDOM.querySelectorAll<HTMLElement>('.nib-image-frame')) {
        const image = imageOfFrame(view, frame)
        // The selection is only shown while it is the editor's, or while the
        // toolbar - part of showing it - holds focus.
        const active = view.hasFocus || frame.contains(document.activeElement)
        const selected = !!image && active && isSelected(state, image.from, image.to)

        let flipped = false
        let shift = 0
        if (selected) {
          const box = (frame.querySelector('.nib-image-box') as HTMLElement).getBoundingClientRect()
          const tools = (frame.querySelector('.nib-image-tools') as HTMLElement).getBoundingClientRect()
          flipped = box.top - scroller.top < tools.height + 16

          // Centred on the picture, but kept inside the view.
          const current = parseFloat(frame.style.getPropertyValue('--nib-tools-shift')) || 0
          const left = tools.left - current
          const right = left + tools.width
          const margin = 8
          if (left < scroller.left + margin) shift = scroller.left + margin - left
          else if (right > scroller.right - margin) shift = scroller.right - margin - right
        }

        out.push({ frame, selected, flipped, shift })
      }

      return out
    }
  },
)

// ── Lightbox ────────────────────────────────────────────────────────

/** Full-window preview. Escape or a click outside closes it; a click on a
 *  picture larger than the window toggles it between fitting and actual
 *  size. Focus goes back to the editor afterwards. */
export function openLightbox(view: EditorView, src: string, alt: string) {
  const backdrop = document.createElement('div')
  backdrop.className = 'nib-lightbox'

  const figure = document.createElement('figure')
  figure.className = 'nib-lightbox-figure'
  backdrop.append(figure)

  const image = document.createElement('img')
  image.src = src
  image.alt = alt
  image.draggable = false
  figure.append(image)

  if (alt) {
    const caption = document.createElement('figcaption')
    caption.textContent = alt
    figure.append(caption)
  }

  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    document.removeEventListener('keydown', onKey, true)
    backdrop.classList.add('is-closing')
    // The fade-out is short; if motion is off it is instant, and the timer
    // is there for either case.
    const done = () => backdrop.remove()
    backdrop.addEventListener('animationend', done, { once: true })
    window.setTimeout(done, 300)
    view.focus()
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  const fits = () =>
    image.naturalWidth <= image.clientWidth + 1 && image.naturalHeight <= image.clientHeight + 1

  image.addEventListener('load', () => backdrop.classList.toggle('can-zoom', !fits()))
  image.addEventListener('click', (event) => {
    event.stopPropagation()
    if (backdrop.classList.contains('is-actual')) {
      backdrop.classList.remove('is-actual')
      backdrop.classList.toggle('can-zoom', !fits())
    } else if (!fits()) {
      backdrop.classList.add('is-actual')
    } else {
      close()
    }
  })

  backdrop.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  document.body.append(backdrop)
}

/** Everything the live preview needs for images beyond the widget itself. */
export const imageExtension = [imageSelection, keymap.of(imageKeymap)]
