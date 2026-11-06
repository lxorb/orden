import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { NibWidget } from './live-preview/widget'

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

class Caret extends NibWidget {
  constructor(
    private readonly name: string,
    private readonly colour: string,
    private readonly at: number,
    private readonly passing: boolean,
    private readonly face?: string,
  ) {
    super()
  }

  override eq(other: Caret): boolean {
    return (
      other.name === this.name &&
      other.colour === this.colour &&
      other.at === this.at &&
      other.passing === this.passing &&
      other.face === this.face
    )
  }

  override toDOM(): HTMLElement {
    const caret = document.createElement('span')
    caret.className = 'cm-nib-caret'
    if (this.passing) caret.classList.add('is-passing')
    caret.style.setProperty('--peer', this.colour)

    const tag = caret.appendChild(document.createElement('span'))
    tag.className = 'cm-nib-caret-name'
    if (this.face) {
      const face = tag.appendChild(document.createElement('span'))
      face.className = 'cm-nib-caret-face'
      face.style.backgroundImage = `url("${this.face}")`
    }
    tag.append(this.name)

    return caret
  }
}

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
  const agent = new Set(agents)

  for (const peer of [...peers, ...agents]) {
    const head = Math.min(Math.max(0, peer.head), length)
    const anchor = Math.min(Math.max(0, peer.anchor), length)

    if (head !== anchor) {
      marks.push(
        Decoration.mark({
          class: 'cm-nib-caret-range',
          attributes: { style: `--peer: ${peer.colour}` },
        }).range(Math.min(anchor, head), Math.max(anchor, head)),
      )
    }

    marks.push(
      Decoration.widget({
        widget: new Caret(peer.name, peer.colour, head, agent.has(peer), peer.face),
        side: 1,
      }).range(head),
    )
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
        head: transaction.changes.mapPos(within(peer.head, before)),
        anchor: transaction.changes.mapPos(within(peer.anchor, before)),
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

const AGENT_SHOWN = '3.4s'

const style = EditorView.baseTheme({
  '.cm-nib-caret': {
    position: 'relative',
    display: 'inline-block',
    width: 0,
    height: '1.15em',
    borderLeft: '2px solid var(--peer)',
    marginLeft: '-1px',
    verticalAlign: 'text-bottom',
    pointerEvents: 'none',
  },

  '.cm-nib-caret-range': {
    backgroundColor: 'color-mix(in srgb, var(--peer) 22%, transparent)',
    borderRadius: '2px',
  },

  '.cm-nib-caret-name': {
    position: 'absolute',
    left: '-1px',
    bottom: '100%',
    padding: '0 4px 1px',
    borderRadius: '3px 3px 3px 0',
    background: 'var(--peer)',
    color: 'var(--accent-ink)',
    font: `500 10px/1.5 var(--font-ui)`,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    WebkitUserSelect: 'none',
    userSelect: 'none',
    pointerEvents: 'none',
    animation: 'cm-nib-caret-name var(--dur-base) var(--ease-out)',
  },

  '.cm-nib-caret-face': {
    display: 'inline-block',
    width: '13px',
    height: '13px',
    margin: '0 3px 0 -2px',
    borderRadius: '50%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    verticalAlign: '-2px',
  },

  '.cm-nib-caret.is-passing': {
    animation: `cm-nib-caret-passing ${AGENT_SHOWN} var(--ease-out) forwards`,
  },

  '.cm-nib-caret.is-passing .cm-nib-caret-name': {
    animation: 'none',
  },

  '@keyframes cm-nib-caret-passing': {
    '0%, 88%': { opacity: 1 },
    to: { opacity: 0 },
  },

  '@keyframes cm-nib-caret-name': {
    from: { opacity: 0, transform: 'translateY(2px)' },
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

function layer(side: 'above' | 'below'): HTMLElement {
  const one = document.createElement('div')
  one.className = `cm-nib-held is-${side}`
  one.setAttribute('aria-hidden', 'true')
  return one
}

function pill(one: Peer): HTMLElement {
  const tag = document.createElement('span')
  tag.className = 'cm-nib-held-name'
  tag.dataset.peer = String(one.id)
  tag.style.setProperty('--peer', one.colour)
  tag.append(one.name)
  return tag
}

function heldCarets(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        private readonly above = layer('above')
        private readonly below = layer('below')
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
          const id = (event.target as Element | null)?.closest<HTMLElement>('.cm-nib-held-name')
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
  '.cm-nib-held': {
    position: 'absolute',
    zIndex: 3,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    padding: '4px 0',
    pointerEvents: 'none',
  },

  '.cm-nib-held:empty': { display: 'none' },

  '.cm-nib-held-name': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '0 5px 1px 4px',
    borderRadius: '3px',
    background: 'var(--peer)',
    color: 'var(--accent-ink)',
    font: `500 10px/1.5 var(--font-ui)`,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    pointerEvents: 'auto',
    cursor: 'pointer',
  },

  '.cm-nib-held-name::before': {
    content: '""',
    borderLeft: '4px solid transparent',
    borderRight: '4px solid transparent',
  },

  '.cm-nib-held.is-above .cm-nib-held-name::before': { borderBottom: '5px solid currentColor' },
  '.cm-nib-held.is-below .cm-nib-held-name::before': { borderTop: '5px solid currentColor' },
})

export function remoteCarets(): Extension {
  return [present, style, heldCarets()]
}

export function peersOf(state: EditorState): readonly Peer[] {
  return state.field(present, false)?.peers ?? []
}

export function agentsOf(state: EditorState): readonly Peer[] {
  return state.field(present, false)?.agents ?? []
}
