import type { EditorView } from '@codemirror/view'
import { COVER_MIDDLE, COVER_POSITION_KEY, type Cover, coverOf } from '@orden/markdown/cover'
import { frontMatterEdit } from '@orden/markdown/front-matter'
import { imageResolver } from '../images'
import { label } from '../labels'
import { applied, clearOfBlock } from './front-matter'
import { coverMover, keptCover } from './kept-cover'
import { NibWidget } from './widget'

const STEP = 5

function inside(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function shownCover(view: EditorView): Cover | null {
  return keptCover(view.state) ?? coverOf(view.state.doc.toString())
}

function writePosition(view: EditorView, position: number) {
  const mover = view.state.facet(coverMover)
  if (keptCover(view.state) && mover) {
    mover(position)
    return
  }
  const source = view.state.doc.toString()
  const edit = frontMatterEdit(source, COVER_POSITION_KEY, String(position))
  if (!edit) return

  const keep = clearOfBlock(view, applied(source, edit))
  view.dispatch({
    changes: edit,
    ...(keep ? { selection: keep } : {}),
    userEvent: 'input.cover.position',
  })
}

export class CoverWidget extends NibWidget {
  constructor(private readonly cover: Cover) {
    super()
  }

  override eq(other: CoverWidget) {
    return other.cover.src === this.cover.src && other.cover.position === this.cover.position
  }

  override get estimatedHeight() {
    return 230
  }

  toDOM(view: EditorView) {
    const host = document.createElement('div')
    host.className = 'nib-cover-block'

    const band = document.createElement('div')
    band.className = 'nib-cover'
    host.append(band)

    const picture = document.createElement('img')
    picture.src = view.state.facet(imageResolver)(this.cover.src)
    picture.alt = ''
    picture.draggable = false
    picture.style.objectPosition = `50% ${this.cover.position}%`
    band.append(picture)

    const handle = document.createElement('div')
    handle.className = 'nib-cover-drag'
    handle.tabIndex = 0
    handle.setAttribute('role', 'slider')
    handle.title = label('dragCover')
    handle.setAttribute('aria-label', label('dragCover'))
    handle.setAttribute('aria-valuemin', '0')
    handle.setAttribute('aria-valuemax', '100')
    handle.setAttribute('aria-orientation', 'vertical')
    handle.setAttribute('aria-valuenow', String(this.cover.position))
    band.append(handle)

    let from = this.cover.position
    let at: number | null = null

    const show = (position: number) => {
      picture.style.objectPosition = `50% ${position}%`
      handle.setAttribute('aria-valuenow', String(position))
    }

    const moved = (event: PointerEvent) => {
      if (at === null) return
      const height = picture.clientHeight || 1
      show(inside(from + ((at - event.clientY) / height) * 100))
    }

    const lifted = (event: PointerEvent) => {
      if (at === null) return
      const height = picture.clientHeight || 1
      const landed = inside(from + ((at - event.clientY) / height) * 100)
      at = null
      handle.releasePointerCapture(event.pointerId)
      if (landed !== from) writePosition(view, landed)
      from = landed
    }

    const pressed = (event: PointerEvent) => {
      if (view.state.readOnly || event.button !== 0) return
      event.preventDefault()
      at = event.clientY
      from = shownCover(view)?.position ?? COVER_MIDDLE
      handle.setPointerCapture(event.pointerId)
    }

    const keyed = (event: KeyboardEvent) => {
      const step = event.key === 'ArrowUp' ? STEP : event.key === 'ArrowDown' ? -STEP : 0
      if (step === 0 || view.state.readOnly) return
      event.preventDefault()
      const now = inside((shownCover(view)?.position ?? COVER_MIDDLE) + step)
      show(now)
      writePosition(view, now)
    }

    handle.addEventListener('pointerdown', pressed)
    handle.addEventListener('pointermove', moved)
    handle.addEventListener('pointerup', lifted)
    handle.addEventListener('pointercancel', lifted)
    handle.addEventListener('keydown', keyed)

    const resized =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => view.requestMeasure()) : null
    resized?.observe(host)

    this.onDestroy(host, () => {
      resized?.disconnect()
      handle.removeEventListener('pointerdown', pressed)
      handle.removeEventListener('pointermove', moved)
      handle.removeEventListener('pointerup', lifted)
      handle.removeEventListener('pointercancel', lifted)
      handle.removeEventListener('keydown', keyed)
    })

    return host
  }

  override ignoreEvent() {
    return true
  }
}
