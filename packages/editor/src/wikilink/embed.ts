import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState, Line } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { DOCUMENT, PLANE } from '@orden/markdown/icons'
import { embedKind, embedSize, isTabFile, pageFragment, parseWikilink, sectionOf } from '@orden/markdown/links'
import { iconElement } from '../icon'
import { followAnchors } from '../links'
import { pressedByKey } from '../press'
import { openLightbox } from '../live-preview/image/lightbox'
import { BaseWidget } from '../live-preview/render'
import { OrdenWidget } from '../live-preview/widget'
import { renderNote } from './preview'
import type { LinkSpan } from './at'
import {
  type FileDrawing,
  jumpFor,
  type NoteIndex,
  noteIndex,
  noteOpener,
  resolveFile,
  resolveLink,
  shownTarget,
} from './notes'

const MOST_EMBEDDED = 40_000
const EMBED_MAX = 512
const OWN_BLOCK = /^(?:ATXHeading\d|FrontMatter|HorizontalRule|FencedCode|BlockMath)$/
const OPENS_BELOW = /^(?:BulletList|OrderedList|Blockquote|Table|HTMLBlock)$/
const LONE_EMBED = /^!\[\[[^[\]]+\]\]$/
function standsApart(state: EditorState, line: Line, below: boolean): boolean {
  const text = line.text.trim()
  if (text === '' || LONE_EMBED.test(text)) return true
  for (let node: SyntaxNode | null = syntaxTree(state).resolve(line.from, 1); node; node = node.parent) {
    if (OWN_BLOCK.test(node.name) || (below && OPENS_BELOW.test(node.name))) {
      return node.from <= line.from && node.to >= line.to
    }
  }
  return false
}
export function embedOfBlock(state: EditorState, from: number, to: number): LinkSpan | null {
  if (to - from > EMBED_MAX || state.sliceDoc(from, from + 3) !== '![[') return null
  const doc = state.doc
  const line = doc.lineAt(from)
  const text = line.text.trim()
  if (from !== line.from + (line.text.length - line.text.trimStart().length)) return null
  if (to !== line.from + line.text.trimEnd().length) return null
  if (line.number > 1 && !standsApart(state, doc.line(line.number - 1), false)) return null
  if (line.number < doc.lines && !standsApart(state, doc.line(line.number + 1), true)) return null
  if (!text.startsWith('![[') || !text.endsWith(']]')) return null
  const inner = text.slice(3, -2)
  if (/[[\]]/.test(inner)) return null
  const link = parseWikilink(inner, true)
  return link && { ...link, kind: 'wikilink', from, to }
}
export class EmbedWidget extends OrdenWidget {
  constructor(
    private readonly link: LinkSpan,
    private readonly path: string | null,
    private readonly index?: NoteIndex,
  ) {
    super()
  }
  override eq(other: EmbedWidget) {
    return (
      other.path === this.path &&
      other.index === this.index &&
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
    followAnchors(body, () => view)
    frame.append(body)
    const caption = document.createElement('button')
    caption.className = 'orden-embed-name'
    caption.type = 'button'
    caption.textContent = this.link.alias ?? shownTarget(this.link, this.path)
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
    this.fill(view, frame, body, true)
    return frame
  }
  override updateDOM(dom: HTMLElement, view: EditorView, previous: EmbedWidget) {
    const same =
      previous.path === this.path &&
      previous.link.target === this.link.target &&
      previous.link.heading === this.link.heading &&
      previous.link.block === this.link.block &&
      previous.link.alias === this.link.alias
    const body = dom.querySelector<HTMLElement>('.orden-embed-body')
    if (!same || !body) return false
    this.fill(view, dom, body, false)
    return true
  }
  private fill(view: EditorView, frame: HTMLElement, body: HTMLElement, first: boolean) {
    const turn = (filling.get(frame) ?? 0) + 1
    filling.set(frame, turn)
    const current = () => body.isConnected && filling.get(frame) === turn
    const shown = (html: string) => {
      frame.classList.remove('orden-embed-loading', 'orden-embed-missing')
      if (body.innerHTML !== html) body.innerHTML = html
    }
    const missing = (words = 'Note not found') => {
      frame.classList.remove('orden-embed-loading')
      frame.classList.add('orden-embed-missing')
      body.textContent = words
    }
    if (this.path === null) {
      missing()
      return
    }
    const path = this.path
    const index = view.state.facet(noteIndex)
    if (index.locked?.(path)) {
      missing('Protected')
      return
    }
    if (first) frame.classList.add('orden-embed-loading')
    void index
      .read(path)
      .then(async (source) => {
        if (first ? !body.isConnected : !current()) return
        const section = source === null ? null : sectionOf(source, this.link)
        if (section === null) {
          missing()
          return
        }
        const html = await renderNote(section.slice(0, MOST_EMBEDDED), path, view.state)
        if (current()) shown(html)
      })
      .catch(() => {
        if (current()) missing()
      })
  }
  override ignoreEvent() {
    return true
  }
}
const filling = new WeakMap<HTMLElement, number>()
export function drawnAsLink(state: EditorState, link: LinkSpan): boolean {
  const kind = embedKind(link.target)
  if (kind === 'pdf' || kind === 'canvas' || kind === 'base') return false
  if (isTabFile(link.target)) return true
  if (!link.target) return false
  const path = resolveLink(state.facet(noteIndex), link, link.kind)?.path ?? null
  return path !== null && isTabFile(path)
}
export function embedWidget(state: EditorState, link: LinkSpan): EmbedWidget | EmbedFileWidget | BaseWidget {
  const index = state.facet(noteIndex)
  const kind = embedKind(link.target)
  if (kind === 'base' && index.mountBase) return new BaseWidget({ target: link.target, view: link.heading }, index)
  if (kind === 'pdf' || kind === 'canvas')
    return new EmbedFileWidget(link, kind, resolveFile(index, link.target, link.kind))
  const path = link.target ? (resolveLink(index, link, link.kind)?.path ?? null) : index.path
  return new EmbedWidget(link, path, index)
}
export class EmbedImageWidget extends OrdenWidget {
  constructor(
    private readonly link: LinkSpan,
    private readonly address: string,
  ) {
    super()
  }
  override eq(other: EmbedImageWidget) {
    return (
      other.address === this.address && other.link.target === this.link.target && other.link.alias === this.link.alias
    )
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
    picture.src = this.address
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
    private readonly address: string,
  ) {
    super()
  }
  override eq(other: EmbedMediaWidget) {
    return (
      other.kind === this.kind &&
      other.address === this.address &&
      other.link.target === this.link.target &&
      other.link.alias === this.link.alias
    )
  }
  toDOM() {
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
    player.src = this.address
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
    name.textContent = this.link.alias ?? shownTarget(this.link, this.path)
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
