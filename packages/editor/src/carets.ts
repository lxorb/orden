import {
  EditorSelection,
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  type LayerMarker,
  layer,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

export interface Peer {
  id: number
  name: string
  colour: string
  face?: string | undefined
  head: number
  anchor: number
}

export const setPeers = StateEffect.define<readonly Peer[]>()

export const setAgents = StateEffect.define<readonly Peer[]>()

interface Present {
  peers: readonly Peer[]
  agents: readonly Peer[]
  marks: DecorationSet
}

const nobody: Present = { peers: [], agents: [], marks: Decoration.none }

function marksFor(
  state: EditorState,
  peers: readonly Peer[],
  agents: readonly Peer[],
): DecorationSet {
  const length = state.doc.length
  const marks: Range<Decoration>[] = []

  for (const peer of [...peers, ...agents]) {
    const head = Math.min(Math.max(0, peer.head), length)
    const anchor = Math.min(Math.max(0, peer.anchor), length)

    if (head !== anchor) {
      marks.push(
        Decoration.mark({
          class: 'cm-orden-caret-range',
          attributes: { style: `--peer: ${peer.colour}` },
        }).range(Math.min(anchor, head), Math.max(anchor, head)),
      )
    }
  }

  return Decoration.set(marks, true)
}

const present = StateField.define<Present>({
  create: () => nobody,
  update: (held, transaction) => {
    let told = held
    const within = (at: number, length: number) => Math.max(0, Math.min(at, length))
    const before = transaction.startState.doc.length
    const moved = (peers: readonly Peer[]) =>
      peers.map((peer) => ({
        ...peer,
        head: transaction.changes.mapPos(within(peer.head, before), 1),
        anchor: transaction.changes.mapPos(within(peer.anchor, before), 1),
      }))
    const placed = (peers: readonly Peer[]) => {
      const length = transaction.state.doc.length
      return peers.map((peer) => ({
        ...peer,
        head: within(peer.head, length),
        anchor: within(peer.anchor, length),
      }))
    }

    if (transaction.docChanged && (held.peers.length || held.agents.length)) {
      told = {
        peers: moved(held.peers),
        agents: moved(held.agents),
        marks: held.marks.map(transaction.changes),
      }
    }

    for (const effect of transaction.effects) {
      if (effect.is(setPeers)) told = { ...told, peers: placed(effect.value) }
      else if (effect.is(setAgents)) told = { ...told, agents: placed(effect.value) }
      else continue

      told = { ...told, marks: marksFor(transaction.state, told.peers, told.agents) }
    }

    return told
  },
  provide: (field) => EditorView.decorations.from(field, (held) => held.marks),
})

export interface Shown {
  peer: Peer
  head: number
  passing: boolean
}

export function caretsAt(state: EditorState): Shown[] {
  const held = state.field(present, false)
  if (!held) return []
  const length = state.doc.length
  const agents = new Set(held.agents)
  return [...held.peers, ...held.agents]
    .map((peer) => ({
      peer,
      head: Math.min(Math.max(0, peer.head), length),
      passing: agents.has(peer),
    }))
    .sort((one, two) => one.head - two.head)
}

export type Side = 'above' | 'below'

export function sideFor(room: boolean, above: boolean, below: boolean): Side {
  if (!room) return 'below'
  return above && !below ? 'below' : 'above'
}

export function inkOn(colour: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())?.[1]
  if (!hex) return 'var(--accent-ink)'
  const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => {
    const one = Number.parseInt(full.slice(at, at + 2), 16) / 255
    return one <= 0.04045 ? one / 12.92 : ((one + 0.055) / 1.055) ** 2.4
  })
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return (light + 0.05) / 0.05 >= 1.05 / (light + 0.05) ? '#0b0d10' : '#ffffff'
}

const NAME_TALL = 16
const NAME_GAP = 4

class CaretMarker implements LayerMarker {
  constructor(
    readonly key: number,
    readonly name: string,
    readonly colour: string,
    readonly face: string | undefined,
    readonly passing: boolean,
    readonly head: number,
    readonly left: number,
    readonly top: number,
    readonly tall: number,
    readonly side: Side,
    readonly shift: number,
  ) {}

  eq(other: CaretMarker): boolean {
    return (
      other.key === this.key &&
      other.name === this.name &&
      other.colour === this.colour &&
      other.face === this.face &&
      other.passing === this.passing &&
      other.head === this.head &&
      other.left === this.left &&
      other.top === this.top &&
      other.tall === this.tall &&
      other.side === this.side &&
      other.shift === this.shift
    )
  }

  draw(): HTMLElement {
    const caret = document.createElement('div')
    caret.className = 'cm-orden-caret'
    if (this.passing) caret.classList.add('is-passing')

    const tag = caret.appendChild(document.createElement('span'))
    tag.className = 'cm-orden-caret-name'
    if (this.face) {
      const face = tag.appendChild(document.createElement('img'))
      face.className = 'cm-orden-caret-face'
      face.alt = ''
      face.draggable = false
      face.onerror = () => face.remove()
      face.src = this.face
    }
    tag.append(this.name)

    this.place(caret)
    return caret
  }

  update(dom: HTMLElement, was: CaretMarker): boolean {
    if (
      !(was instanceof CaretMarker) ||
      was.key !== this.key ||
      was.name !== this.name ||
      was.face !== this.face ||
      was.passing !== this.passing ||
      (this.passing && was.head !== this.head)
    ) {
      return false
    }
    this.place(dom)
    return true
  }

  private place(caret: HTMLElement) {
    caret.style.left = `${this.left}px`
    caret.style.top = `${this.top}px`
    caret.style.height = `${this.tall}px`
    caret.style.setProperty('--peer', this.colour)
    caret.style.setProperty('--peer-ink', inkOn(this.colour))
    caret.classList.toggle('is-below', this.side === 'below')
    caret.classList.toggle('is-shifted', this.shift < 0)
    const tag = caret.firstElementChild as HTMLElement | null
    if (tag) tag.style.left = `${this.shift}px`
  }
}

let ruler: CanvasRenderingContext2D | null | undefined

function widthOf(view: EditorView, name: string, face: boolean): number {
  if (ruler === undefined) {
    try {
      ruler = document.createElement('canvas').getContext('2d')
    } catch {
      ruler = null
    }
  }
  const font = getComputedStyle(view.dom).getPropertyValue('--font-ui').trim() || 'sans-serif'
  let words = name.length * 6.5
  if (ruler) {
    ruler.font = `600 10px ${font}`
    words = ruler.measureText(name).width + name.length * 0.2
  }
  return Math.ceil(words + 10 + (face ? 15 : 0))
}

function lineTall(view: EditorView, head: number, text: number): number {
  const { node } = view.domAtPos(head)
  const element = node instanceof Element ? node : node.parentElement
  const line = element?.closest('.cm-line')
  const said = line ? Number.parseFloat(getComputedStyle(line).lineHeight) : Number.NaN
  return Number.isFinite(said) && said > text ? said : text
}

function crowded(view: EditorView, from: number, to: number, y: number): boolean {
  const height = y - view.documentTop
  if (height < 0 || height > view.contentHeight) return false
  const block = view.lineBlockAtHeight(height)
  if (block.type !== BlockType.Text) return true
  const at = view.posAtCoords({ x: from, y }, false)
  const start = view.coordsAtPos(view.moveToLineBoundary(EditorSelection.cursor(at), false).head, 1)
  const end = view.coordsAtPos(view.moveToLineBoundary(EditorSelection.cursor(at), true).head, -1)
  if (!start || !end || y < start.top - 1 || y > start.bottom + 1) return false
  return start.left < to && end.right > from
}

function caretMarkers(view: EditorView): CaretMarker[] {
  const shown = caretsAt(view.state)
  if (!shown.length) return []

  const scroller = view.scrollDOM.getBoundingClientRect()
  const base = {
    left: scroller.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: scroller.top - view.scrollDOM.scrollTop * view.scaleY,
  }
  const edge = scroller.left + view.scrollDOM.clientWidth * view.scaleX - NAME_GAP
  const markers: CaretMarker[] = []

  for (const { peer, head, passing } of shown) {
    if (head < view.viewport.from || head > view.viewport.to) continue
    const at = view.coordsAtPos(head, 1) ?? view.coordsAtPos(head, -1)
    if (!at) continue

    const tall = lineTall(view, head, at.bottom - at.top)
    const top = (at.top + at.bottom) / 2 - tall / 2
    const wide = widthOf(view, peer.name, !!peer.face)
    const shift = Math.min(0, Math.max(-wide, edge - (at.left + wide)))
    const from = at.left + shift
    const to = from + wide
    const side = sideFor(
      top - NAME_TALL >= base.top,
      crowded(view, from, to, top - NAME_TALL / 2),
      crowded(view, from, to, top + tall + NAME_TALL / 2),
    )

    markers.push(
      new CaretMarker(
        peer.id,
        peer.name,
        peer.colour,
        peer.face,
        passing,
        head,
        Math.round(at.left - base.left),
        Math.round(top - base.top),
        Math.round(tall),
        side,
        Math.round(shift),
      ),
    )
  }

  return markers
}

const caretLayer = layer({
  above: true,
  class: 'cm-orden-carets',
  markers: caretMarkers,
  update: (update: ViewUpdate) =>
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.startState.field(present, false) !== update.state.field(present, false),
})

const AGENT_SHOWN = '3.4s'

const style = EditorView.baseTheme({
  '.cm-orden-carets': {
    pointerEvents: 'none',
  },

  '.cm-orden-caret': {
    position: 'absolute',
    width: '2px',
    marginLeft: '-1px',
    borderRadius: '1px',
    background: 'var(--peer)',
    pointerEvents: 'none',
  },

  '.cm-orden-caret-range': {
    backgroundColor: 'color-mix(in srgb, var(--peer) 22%, transparent)',
    borderRadius: '2px',
  },

  '.cm-orden-caret-name': {
    position: 'absolute',
    bottom: '100%',
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    width: 'max-content',
    height: `${NAME_TALL}px`,
    padding: '0 5px',
    borderRadius: '4px 4px 4px 0',
    background: 'var(--peer)',
    color: 'var(--peer-ink)',
    font: `600 10px/1 var(--font-ui)`,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    textAlign: 'left',
    direction: 'ltr',
    WebkitUserSelect: 'none',
    userSelect: 'none',
    pointerEvents: 'none',
    animation: 'cm-orden-caret-name var(--dur-base) var(--ease-out)',
  },

  '.cm-orden-caret.is-below .cm-orden-caret-name': {
    top: '100%',
    bottom: 'auto',
    borderRadius: '0 4px 4px 4px',
  },

  '.cm-orden-caret.is-shifted .cm-orden-caret-name': {
    borderRadius: '4px',
  },

  '.cm-orden-caret-face': {
    flex: 'none',
    width: '12px',
    height: '12px',
    margin: '0 3px 0 -2px',
    borderRadius: '50%',
    objectFit: 'cover',
  },

  '.cm-orden-caret.is-passing': {
    animation: `cm-orden-caret-passing ${AGENT_SHOWN} var(--ease-out) forwards`,
  },

  '.cm-orden-caret.is-passing .cm-orden-caret-name': {
    animation: 'none',
  },

  '@keyframes cm-orden-caret-passing': {
    '0%, 88%': { opacity: 1 },
    to: { opacity: 0 },
  },

  '@keyframes cm-orden-caret-name': {
    from: { opacity: 0 },
  },
})

export interface OutOfSight<T> {
  above: T[]
  below: T[]
}

export function outOfSight<T extends { head: number }>(
  people: readonly T[],
  lineAt: (at: number) => { top: number; bottom: number },
  seen: { top: number; bottom: number },
): OutOfSight<T> {
  const out: OutOfSight<T> = { above: [], below: [] }
  for (const one of people) {
    const line = lineAt(one.head)
    if (line.bottom <= seen.top) out.above.push(one)
    else if (line.top >= seen.bottom) out.below.push(one)
  }
  return out
}

interface Held {
  sides: OutOfSight<Peer>
  top: number
  bottom: number
  left: number
}

function heldRow(side: 'above' | 'below'): HTMLElement {
  const one = document.createElement('div')
  one.className = `cm-orden-held is-${side}`
  one.setAttribute('aria-hidden', 'true')
  return one
}

function pill(one: Peer): HTMLElement {
  const tag = document.createElement('span')
  tag.className = 'cm-orden-held-name'
  tag.dataset.peer = String(one.id)
  tag.style.setProperty('--peer', one.colour)
  tag.style.setProperty('--peer-ink', inkOn(one.colour))
  tag.append(one.name)
  return tag
}

function heldCarets(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        private readonly above = heldRow('above')
        private readonly below = heldRow('below')
        private drawn = ''
        private readonly look = () => this.view.requestMeasure(this.measure)

        private readonly measure = {
          key: this,
          read: (view: EditorView): Held | null => {
            const people = peersOf(view.state)
            if (!people.length) return null

            const box = view.scrollDOM.getBoundingClientRect()
            const dom = view.dom.getBoundingClientRect()
            const top = Math.max(box.top, 0)
            const bottom = Math.min(box.bottom, window.innerHeight)
            const length = view.state.doc.length
            const sides = outOfSight(
              people,
              (at) => {
                const line = view.lineBlockAt(Math.min(Math.max(0, at), length))
                return {
                  top: view.documentTop + line.top,
                  bottom: view.documentTop + line.bottom,
                }
              },
              { top, bottom },
            )
            return {
              sides,
              top: top - dom.top,
              bottom: dom.bottom - bottom,
              left: view.contentDOM.getBoundingClientRect().left - dom.left,
            }
          },
          write: (held: Held | null) => this.draw(held),
        }

        private readonly go = (event: MouseEvent) => {
          const id = (event.target as Element | null)?.closest<HTMLElement>('.cm-orden-held-name')
            ?.dataset.peer
          const one = peersOf(this.view.state).find((peer) => String(peer.id) === id)
          if (!one) return
          event.preventDefault()
          const at = Math.min(Math.max(0, one.head), this.view.state.doc.length)
          this.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) })
        }

        private readonly keep = (event: MouseEvent) => event.preventDefault()

        constructor(private readonly view: EditorView) {
          for (const side of [this.above, this.below]) {
            side.addEventListener('mousedown', this.keep)
            side.addEventListener('click', this.go)
          }
          view.dom.append(this.above, this.below)
          window.addEventListener('scroll', this.look, true)
          window.addEventListener('resize', this.look)
          this.look()
        }

        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.geometryChanged ||
            peersOf(update.startState) !== peersOf(update.state)
          ) {
            this.look()
          }
        }

        private draw(held: Held | null) {
          const above = held?.sides.above ?? []
          const below = held?.sides.below ?? []
          if (held) {
            this.above.style.top = `${held.top}px`
            this.below.style.bottom = `${held.bottom}px`
            this.above.style.left = this.below.style.left = `${held.left}px`
          }

          const said = JSON.stringify(
            [above, below].map((side) => side.map((one) => [one.id, one.name, one.colour])),
          )
          if (said === this.drawn) return
          this.drawn = said
          this.above.replaceChildren(...above.map(pill))
          this.below.replaceChildren(...below.map(pill))
        }

        destroy() {
          window.removeEventListener('scroll', this.look, true)
          window.removeEventListener('resize', this.look)
          this.above.remove()
          this.below.remove()
        }
      },
    ),
    heldStyle,
  ]
}

const heldStyle = EditorView.baseTheme({
  '.cm-orden-held': {
    position: 'absolute',
    zIndex: 3,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    padding: '4px 0',
    pointerEvents: 'none',
  },

  '.cm-orden-held:empty': { display: 'none' },

  '.cm-orden-held-name': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '0 5px 1px 4px',
    borderRadius: '3px',
    background: 'var(--peer)',
    color: 'var(--peer-ink)',
    font: `500 10px/1.5 var(--font-ui)`,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    pointerEvents: 'auto',
    cursor: 'pointer',
  },

  '.cm-orden-held-name::before': {
    content: '""',
    borderLeft: '4px solid transparent',
    borderRight: '4px solid transparent',
  },

  '.cm-orden-held.is-above .cm-orden-held-name::before': { borderBottom: '5px solid currentColor' },
  '.cm-orden-held.is-below .cm-orden-held-name::before': { borderTop: '5px solid currentColor' },
})

export function remoteCarets(): Extension {
  return [present, caretLayer, style, heldCarets()]
}

export function peersOf(state: EditorState): readonly Peer[] {
  return state.field(present, false)?.peers ?? []
}

export function agentsOf(state: EditorState): readonly Peer[] {
  return state.field(present, false)?.agents ?? []
}
