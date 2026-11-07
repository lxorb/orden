import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { DOCUMENT, PLANE } from '@orden/markdown/icons'
import {
  embedKind,
  embedSize,
  linkTarget,
  pageFragment,
  parseWikilink,
  sectionOf,
} from '@orden/markdown/links'
import { iconElement } from '../icon'
import { imageResolver } from '../images'
import { label } from '../labels'
import { pressedByKey } from '../press'
import { openLightbox } from '../live-preview/image/lightbox'
import { BaseWidget } from '../live-preview/render'
import { OrdenWidget } from '../live-preview/widget'
import { renderNote } from './preview'
import type { LinkSpan } from './at'
import { type FileDrawing, jumpFor, noteIndex, noteOpener, resolveFile, resolveLink } from './notes'

const MOST_EMBEDDED = 40_000

const EMBED_MAX = 512

export function embedOfBlock(state: EditorState, from: number, to: number): LinkSpan | null {
  if (to - from > EMBED_MAX || state.sliceDoc(from, from + 3) !== '![[') return null

  const doc = state.doc
  const line = doc.lineAt(from)
  const text = line.text.trim()

  if (from !== line.from + (line.text.length - line.text.trimStart().length)) return null
  if (to !== line.from + line.text.trimEnd().length) return null

  const above = line.number > 1 ? doc.line(line.number - 1).text : ''
  const below = line.number < doc.lines ? doc.line(line.number + 1).text : ''
  if (above.trim() !== '' || below.trim() !== '') return null

  if (!text.startsWith('![[') || !text.endsWith(']]')) return null

  const link = parseWikilink(text.slice(3, -2), true)
  return link && { ...link, kind: 'wikilink', from, to }
}

export class EmbedWidget extends OrdenWidget {
  constructor(
    private readonly link: LinkSpan,
    private readonly path: string | null,
  ) {
    super()
  }

  override eq(other: EmbedWidget) {
    return (
      other.path === this.path &&
      other.link.target === this.link.target &&
      other.link.heading === this.link.heading &&
      other.link.block === this.link.block &&
      other.link.alias === this.link.alias
    )
  }

  toDOM(view: EditorView) {
    const frame = document.createElement('div')
    frame.className = 'orden-embed'

    const body = document.createElement('div')
    body.className = 'orden-embed-body'
    frame.append(body)

    const caption = document.createElement('button')
    caption.className = 'orden-embed-name'
    caption.type = 'button'
    caption.textContent = this.link.alias ?? linkTarget(this.link)
    const open = (press?: MouseEvent) => {
      const state = view.state
      state.facet(noteOpener)(jumpFor(state.facet(noteIndex), this.link, this.link.kind), press)
    }
    caption.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      open(event)
    })
    pressedByKey(caption, () => open())
    frame.append(caption)

    const missing = () => {
      frame.classList.remove('orden-embed-loading')
      frame.classList.add('orden-embed-missing')
      body.textContent = label('noteNotFound')
    }

    if (this.path === null) {
      missing()
      return frame
    }

    if (view.state.facet(noteIndex).locked?.(this.path)) {
      frame.classList.add('orden-embed-missing')
      body.textContent = label('protectedNote')
      return frame
    }

    frame.classList.add('orden-embed-loading')

    const showing = () => body.isConnected

    void view.state
      .facet(noteIndex)
      .read(this.path)
      .then(async (source) => {
        if (!showing()) return

        const section = source === null ? null : sectionOf(source, this.link)
        if (section === null) {
          missing()
          return
        }

        const html = await renderNote(section.slice(0, MOST_EMBEDDED), this.path, view.state)
        if (!showing()) return

        frame.classList.remove('orden-embed-loading')
        body.innerHTML = html
      })
      .catch(() => {
        if (showing()) missing()
      })

    return frame
  }

  override ignoreEvent() {
    return true
  }
}

export function embedWidget(
  state: EditorState,
  link: LinkSpan,
): EmbedWidget | EmbedFileWidget | BaseWidget {
  const index = state.facet(noteIndex)
  const kind = embedKind(link.target)

  if (kind === 'base' && index.mountBase)
    return new BaseWidget({ target: link.target, view: link.heading }, index)

  if (kind === 'pdf' || kind === 'canvas') {
    return new EmbedFileWidget(link, kind, resolveFile(index, link.target, link.kind))
  }

  const path = link.target ? (resolveLink(index, link, link.kind)?.path ?? null) : index.path
  return new EmbedWidget(link, path)
}

export class EmbedImageWidget extends OrdenWidget {
  constructor(private readonly link: LinkSpan) {
    super()
  }

  override eq(other: EmbedImageWidget) {
    return other.link.target === this.link.target && other.link.alias === this.link.alias
  }

  toDOM(view: EditorView) {
    const picture = document.createElement('img')
    picture.className = 'orden-embed-image'
    picture.draggable = false
    picture.alt = ''

    const size = embedSize(this.link.alias)
    if (size) {
      picture.width = size.width
      if (size.height !== null) picture.height = size.height
    } else if (this.link.alias) {
      picture.alt = this.link.alias
    }

    picture.addEventListener('dragstart', (event) => event.preventDefault())
    picture.addEventListener('dblclick', (event) => {
      event.preventDefault()
      openLightbox(view, picture.src, picture.alt)
    })

    picture.src = view.state.facet(imageResolver)(this.link.target)
    return picture
  }

  override ignoreEvent(event: Event) {
    return event.type === 'dblclick'
  }
}

export class EmbedMediaWidget extends OrdenWidget {
  constructor(
    private readonly link: LinkSpan,
    private readonly kind: 'audio' | 'video',
  ) {
    super()
  }

  override eq(other: EmbedMediaWidget) {
    return (
      other.kind === this.kind &&
      other.link.target === this.link.target &&
      other.link.alias === this.link.alias
    )
  }

  toDOM(view: EditorView) {
    const player = document.createElement(this.kind)
    player.className = `orden-embed-media orden-embed-${this.kind}`
    player.controls = true
    player.preload = 'metadata'
    player.draggable = false

    const size = embedSize(this.link.alias)
    if (size && player instanceof HTMLVideoElement) {
      player.width = size.width
      if (size.height !== null) player.height = size.height
    } else if (this.link.alias !== null && size === null) {
      player.title = this.link.alias
    }

    player.addEventListener('dragstart', (event) => event.preventDefault())
    player.src = view.state.facet(imageResolver)(this.link.target)

    this.onDestroy(player, () => {
      player.pause()
      player.removeAttribute('src')
      player.load()
    })

    return player
  }

  override ignoreEvent() {
    return true
  }
}

export class EmbedFileWidget extends OrdenWidget {
  constructor(
    private readonly link: LinkSpan,
    private readonly kind: 'pdf' | 'canvas',
    private readonly path: string | null,
  ) {
    super()
  }

  override eq(other: EmbedFileWidget) {
    return (
      other.kind === this.kind &&
      other.path === this.path &&
      other.link.target === this.link.target &&
      other.link.heading === this.link.heading &&
      other.link.alias === this.link.alias
    )
  }

  drawing(): FileDrawing | null {
    if (this.path === null) return null

    return {
      kind: this.kind,
      path: this.path,
      page: this.kind === 'pdf' ? pageFragment(this.link.heading) : null,
    }
  }

  toDOM(view: EditorView) {
    const card = document.createElement('button')
    card.className = 'orden-embed orden-embed-file'
    card.type = 'button'
    card.dataset.kind = this.kind
    if (this.path === null) card.classList.add('orden-embed-missing')

    card.append(iconElement(this.kind === 'pdf' ? DOCUMENT : PLANE, 'orden-embed-icon'))

    const name = document.createElement('span')
    name.className = 'orden-embed-name'
    name.textContent = this.link.alias ?? linkTarget(this.link)
    card.append(name)

    const open = (press?: MouseEvent) => {
      const state = view.state
      state.facet(noteOpener)(jumpFor(state.facet(noteIndex), this.link, this.link.kind), press)
    }
    card.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      open(event)
    })
    pressedByKey(card, () => open())

    const drawing = this.drawing()
    const draw = view.state.facet(noteIndex).drawFile
    if (drawing !== null && draw !== undefined) this.onDestroy(card, draw(card, drawing))

    return card
  }

  override ignoreEvent() {
    return true
  }
}
