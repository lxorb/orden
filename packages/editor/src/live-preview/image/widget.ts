import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { imageResolver } from '../../images'
import { label as uiLabel } from '../../labels'
import { NibWidget } from '../widget'
import { openLightbox } from './lightbox'
import {
  imageAt,
  type ImageSpan,
  type ImageSpec,
  imageMarkup,
  sourceCaret,
  withZoom,
} from './markup'
import { resizeTo } from './size'
import { selectedImage, selectionOver } from './selection'

const NATURAL = new Map<string, { width: number; height: number }>()

function displayWidth(spec: ImageSpec, natural: number | undefined): string {
  if (spec.zoom !== 100)
    return natural ? `${Math.round((natural * spec.zoom) / 100)}px` : `${spec.zoom}%`
  return spec.width ? `${spec.width}px` : ''
}

function sizeLabel(zoom: number, natural: number | undefined): string {
  const pixels = natural ? ` · ${Math.round((natural * zoom) / 100)}px` : ''
  return `${zoom}%${pixels}`
}

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

export interface Parts {
  frame: HTMLElement
  box: HTMLElement
  image: HTMLImageElement
  missing: HTMLElement
  alt: HTMLInputElement
  size: HTMLButtonElement
  badge: HTMLElement
  tools: HTMLElement
}

const PARTS = new WeakMap<HTMLElement, Parts>()

export function partsOf(frame: HTMLElement): Parts | null {
  return PARTS.get(frame) ?? null
}

export function imageOfFrame(view: EditorView, frame: HTMLElement): ImageSpan | null {
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

function rewrite(view: EditorView, image: ImageSpan, next: ImageSpec, userEvent: string) {
  const insert = imageMarkup(next)
  const wasSelected = selectedImage(view.state)?.from === image.from

  view.dispatch({
    changes: { from: image.from, to: image.to, insert },
    selection: wasSelected
      ? EditorSelection.range(image.from, image.from + insert.length)
      : undefined,
    userEvent,
  })
}

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

  override eq(other: ImageWidget) {
    const a = this.spec
    const b = other.spec
    return (
      a.src === b.src &&
      a.alt === b.alt &&
      a.title === b.title &&
      a.zoom === b.zoom &&
      a.width === b.width
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
    const path = document.createElement('span')
    missing.append(icon(ICONS.missing), path)
    box.append(missing)

    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('span')
      handle.className = 'nib-image-handle'
      handle.dataset.corner = corner
      handle.title = uiLabel('dragToResize')
      handle.addEventListener('pointerdown', (event) =>
        this.startResize(event, view, frame, handle),
      )
      box.append(handle)
    }

    const badge = document.createElement('span')
    badge.className = 'nib-image-badge'
    box.append(badge)

    const toolbar = this.toolbar(view, frame)
    box.append(toolbar.tools)

    PARTS.set(frame, {
      frame,
      box,
      image,
      missing: path,
      alt: toolbar.alt,
      size: toolbar.size,
      badge,
      tools: toolbar.tools,
    })

    const src = view.state.facet(imageResolver)(this.spec.src)
    frame.dataset.src = src
    const known = NATURAL.get(src)
    if (known) {
      image.width = known.width
      image.height = known.height
      frame.classList.remove('is-loading')
    }

    image.addEventListener('load', () => {
      NATURAL.set(src, { width: image.naturalWidth, height: image.naturalHeight })
      if (!known) frame.classList.add('is-fresh')
      frame.classList.remove('is-loading', 'is-broken')
      this.sync(frame, imageOfFrame(view, frame) ?? this.spec)
    })
    image.addEventListener('error', () => {
      frame.classList.remove('is-loading')
      frame.classList.add('is-broken')
    })

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

  override updateDOM(frame: HTMLElement, view: EditorView): boolean {
    if (frame.dataset.src !== view.state.facet(imageResolver)(this.spec.src)) return false
    return this.sync(frame, this.spec)
  }

  private sync(frame: HTMLElement, image: ImageSpec): boolean {
    const parts = partsOf(frame)
    if (!parts) return false

    const natural = NATURAL.get(frame.dataset.src ?? '')?.width

    parts.image.alt = image.alt
    parts.image.title = image.title
    parts.image.style.width = displayWidth(image, natural)
    parts.missing.textContent = image.src

    if (document.activeElement !== parts.alt) parts.alt.value = image.alt
    parts.size.textContent = sizeLabel(image.zoom, natural)
    const plain = image.zoom === 100 && !image.width
    parts.size.disabled = plain
    parts.size.title = plain ? '' : uiLabel('resetSize')
    return true
  }

  private inToolbar(event: Event): boolean {
    const target = event.target
    return target instanceof Element && target.closest('.nib-image-tools') !== null
  }

  private toolbar(
    view: EditorView,
    frame: HTMLElement,
  ): { tools: HTMLElement; alt: HTMLInputElement; size: HTMLButtonElement } {
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
    alt.addEventListener('blur', () => queueMicrotask(commitAlt))
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

    const size = button('nib-image-size', '', '', (image) => {
      if (image.zoom !== 100 || image.width) {
        rewrite(view, image, withZoom(image, 100), 'input.image.resize')
      }
      view.focus()
    })

    button('nib-image-open', uiLabel('openImage'), icon(ICONS.open), (image) => {
      const picture = partsOf(frame)?.image
      if (picture && !frame.classList.contains('is-broken')) {
        openLightbox(view, picture.src, image.alt)
      }
    })

    const copy = button('nib-image-copy', uiLabel('copyLink'), icon(ICONS.link), (image) => {
      navigator.clipboard
        .writeText(image.src)
        .then(() => {
          copy.classList.add('is-copied')
          copy.title = uiLabel('copied')
          copy.replaceChildren(icon(ICONS.copied))
          window.setTimeout(() => {
            copy.classList.remove('is-copied')
            copy.title = uiLabel('copyLink')
            copy.replaceChildren(icon(ICONS.link))
          }, 1400)
        })
        .catch(() => undefined)
    })

    button('nib-image-source', uiLabel('editMarkdown'), icon(ICONS.source), (image) => {
      view.focus()
      view.dispatch({
        selection: EditorSelection.cursor(sourceCaret(view.state, image)),
        scrollIntoView: true,
        userEvent: 'select',
      })
    })

    button('nib-image-delete', uiLabel('deleteImage'), icon(ICONS.trash), (image) =>
      remove(view, image),
    )

    return { tools, alt, size }
  }

  private startResize(
    event: PointerEvent,
    view: EditorView,
    frame: HTMLElement,
    handle: HTMLElement,
  ) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const image = imageOfFrame(view, frame)
    const parts = partsOf(frame)
    if (!image || !parts) return

    const remembered = NATURAL.get(frame.dataset.src ?? '')?.width ?? 0
    const natural = remembered > 0 ? remembered : parts.image.naturalWidth
    if (!natural) return

    if (selectedImage(view.state)?.from !== image.from) select(view, image)

    const startX = event.clientX
    const startWidth = parts.image.getBoundingClientRect().width
    const lineWidth = frame.closest('.cm-line')?.getBoundingClientRect().width ?? natural
    const sign = handle.dataset.corner?.endsWith('e') ? 1 : -1
    let zoom = image.zoom

    frame.classList.add('is-resizing')
    frame.dataset.corner = handle.dataset.corner
    parts.badge.textContent = sizeLabel(zoom, natural)
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // Left uncaptured.
    }

    const move = (moved: PointerEvent) => {
      zoom = resizeTo(
        startWidth,
        sign * (moved.clientX - startX),
        natural,
        lineWidth,
        !moved.altKey,
      )
      parts.image.style.width = displayWidth(withZoom(image, zoom), natural)
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
      rewrite(view, current, withZoom(current, zoom), 'input.image.resize')
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  override ignoreEvent() {
    return true
  }
}
