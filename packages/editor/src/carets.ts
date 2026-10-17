/** Where the other people in a note are.
 *
 *  A thin bar in their colour where their caret is, a wash over what they have
 *  selected, and their name above the bar, with their face in front of it where it is
 *  a person's. The name stays: somebody in the note is somebody you can see, and one
 *  whose caret is scrolled out of sight is held at the edge of the page, pointing the
 *  way to them (#386; see `heldCarets` below). That is the whole of it: no
 *  chat, no bubbles following the pointer about. Somebody else writing in the note should read as somebody else writing
 *  in the note.
 *
 *  Two things keep this from costing anything. Positions arrive as plain offsets
 *  and are mapped through every change after that, which CodeMirror does for a
 *  range set for nothing - so a remote caret stays where it belongs while its
 *  owner keeps typing and while you do, and the app only speaks when somebody
 *  actually moves. And the name eases in in CSS rather than on a timer: a caret that
 *  moved is a new widget, whose animation runs from the start, and one that did
 *  not is the same widget, whose name is already there. */

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

/** Somebody else in this note, as the app knows them. */
export interface Peer {
  /** Their client in the room. What tells one caret from another. */
  id: number
  /** The account's name, or the name of their device. Never empty: the app puts
   *  something readable here before it gets this far. */
  name: string
  /** One of the accent colours, as a hex string. */
  colour: string
  /** Their picture's address, where the label names a person who chose one. */
  face?: string | undefined
  /** Where their caret sits, and where their selection started. */
  head: number
  anchor: number
}

/** Who is in the note now, and where. The whole list every time: presence is
 *  small, and a list is one comparison rather than arrivals and departures to
 *  keep in step. */
export const setPeers = StateEffect.define<readonly Peer[]>()

/** The agents writing in the note, as carets of their own: a peer the app makes up
 *  for each, at the place it last wrote. A list apart from the room's, because the
 *  two are told by different things - the room by the devices in it, the app by
 *  the agents - and one list would have each wiping out the other's. Drawn the way a
 *  person's caret is, and gone by itself a few seconds after the agent last wrote,
 *  because an agent is somewhere only while it is writing. See docs/agent-native.md
 *  8.4. */
export const setAgents = StateEffect.define<readonly Peer[]>()

/** One person's caret: a bar, and their name above it.
 *
 *  Where the caret is takes part in what makes one of these equal to another,
 *  even though it is not drawn: it is what tells "the same person, who has not
 *  moved" from "the same person, somewhere else", and the difference is whether
 *  the name eases in again. */
class Caret extends NibWidget {
  constructor(
    private readonly name: string,
    private readonly colour: string,
    private readonly at: number,
    /** An agent's, which fades on its own; see `setAgents`. */
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
    // A picture as a background rather than an image, so no rule a note's own
    // pictures are drawn by can reach it.
    if (this.face) {
      const face = tag.appendChild(document.createElement('span'))
      face.className = 'cm-nib-caret-face'
      face.style.backgroundImage = `url("${this.face}")`
    }
    tag.append(this.name)

    return caret
  }
}

/** The peers and the agents as of the last thing the app said, and the decorations
 *  for them. */
interface Present {
  peers: readonly Peer[]
  agents: readonly Peer[]
  marks: DecorationSet
}

const nobody: Present = { peers: [], agents: [], marks: Decoration.none }

/** The decorations for one list of peers: a caret each, and a wash over whatever
 *  each has selected. Handed over unsorted and sorted by the range set, because a
 *  caret and somebody else's selection can start at the same place and which of the
 *  two goes first is the set's rule rather than this function's. */
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
    const moved = (peers: readonly Peer[]) =>
      peers.map((peer) => ({
        ...peer,
        head: transaction.changes.mapPos(peer.head),
        anchor: transaction.changes.mapPos(peer.anchor),
      }))

    // The words moved under the carets. Mapping is what keeps a remote caret in
    // the same place in the text while somebody types above it, and it costs the
    // size of the change rather than the size of the note.
    if (transaction.docChanged && (held.peers.length || held.agents.length)) {
      told = {
        peers: moved(held.peers),
        agents: moved(held.agents),
        marks: held.marks.map(transaction.changes),
      }
    }

    for (const effect of transaction.effects) {
      if (effect.is(setPeers)) told = { ...told, peers: effect.value }
      else if (effect.is(setAgents)) told = { ...told, agents: effect.value }
      else continue

      told = { ...told, marks: marksFor(transaction.state, told.peers, told.agents) }
    }

    return told
  },
  provide: (field) => EditorView.decorations.from(field, (held) => held.marks),
})

/** How long an agent's caret stays after it last wrote, fading at the end: three
 *  seconds of nothing, and then it is gone. The app takes the peer away when this
 *  has run; see lib/agents/docs/presence.ts. */
const AGENT_SHOWN = '3.4s'

const style = EditorView.baseTheme({
  '.cm-nib-caret': {
    position: 'relative',
    display: 'inline-block',
    width: 0,
    height: '1.15em',
    // A border rather than a background, so the bar lands between two characters
    // and takes no width from the text either side of it.
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
    // Eased in as the caret lands, and then it stays.
    animation: 'cm-nib-caret-name var(--dur-base) var(--ease-out)',
  },

  // A person's face in front of their name, as tall as the label's line and round
  // as a face is everywhere.
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

  // An agent's caret, name and all, stays while it writes and goes when it stops.
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

/* ── Out of sight ─────────────────────────────────────────────────────── */

/** Somebody else's caret when it is out of sight.
 *
 *  A caret scrolled off the page used to be nowhere: two people in one note, one at the
 *  top and one at the bottom, saw nobody (#386). So whoever's caret is above what can be
 *  seen is held at the top edge of it, and whoever's is below at the foot: their name
 *  in their colour, with an arrow pointing the way to them. Scrolling towards the arrow
 *  brings the caret into view, and the name goes back over it; pressing the name scrolls
 *  there.
 *
 *  A layer over the editor rather than a decoration in it, because a decoration is drawn
 *  where its text is, and the text is exactly what is not on screen. Read once a frame,
 *  through the view's own measure cycle, whenever the page scrolls, the window changes
 *  size, the text moves or the carets do. */

/** The people whose caret is above what can be seen, and below it. */
export interface OutOfSight<T> {
  above: T[]
  below: T[]
}

/** Which of the people are out of sight, given where each one's line is and what of
 *  the page is on the screen, both in the same pixels. A line that shows at all is in
 *  sight. Pure; the view's measuring is the plugin's below. */
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

/** What one measure found: who is held where, and where the two edges are inside the
 *  editor's own box. */
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

/** The layer, over a view whose carets are in `present`. */
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

        /** A press on a held name goes to that caret, and leaves this one where it
         *  is: the press is the name's own, and never reaches the text under it. */
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
  // Over the text and out of the way of every pointer: what is under it is still the
  // note's to click.
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

  // The caret's own label, as it is over a caret in sight, with an arrow in front of it
  // pointing up or down to where the caret is.
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
    // The one thing on the layer a pointer may press: it goes to them.
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

/** Everything a view needs to show the other people in the note. */
export function remoteCarets(): Extension {
  return [present, style, heldCarets()]
}

/** Who a view is showing, for a test and for anything that wants to count them. */
export function peersOf(state: EditorState): readonly Peer[] {
  return state.field(present, false)?.peers ?? []
}

/** The agents a view is showing, the same way. */
export function agentsOf(state: EditorState): readonly Peer[] {
  return state.field(present, false)?.agents ?? []
}
