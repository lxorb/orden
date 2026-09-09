/** The page the glasses hold, and how a view reaches it.
 *
 *  Six text containers and nothing else. No image container is made at all: text
 *  mode is the only mode, and a page of words is one `textContainerUpgrade` of
 *  about 83 ms against four image sends of about 185 ms each. See docs/even.md.
 *
 *  The page is made **once** and never rebuilt while it is up, because a rebuild
 *  costs a flat 165 ms. Every screen the plugin shows - the note, the sidebar, the
 *  modal, the two pickers, an answer from the model - is the same six bands with
 *  different words in them, so switching screens costs only the bands that
 *  actually changed. A page turn is two of them; opening the sidebar is three.
 *
 *  The one thing that does rebuild is the column of line numbers, because a
 *  container's geometry is fixed when the page is made and the numbers need a
 *  column of their own to keep the body's left edge straight. Turning them on or
 *  off is a rebuild, once, which is a fair price for a setting nobody changes
 *  twice a day.
 *
 *  Nothing is sent that is already on the glass. Every band remembers what it was
 *  last given, which is what makes a keystroke cost nothing when the page it
 *  changed is not the page in front of the reader. */

import { type Band, type BandName, bandsOf, BRIGHT, PANEL_HEIGHT, PANEL_WIDTH } from '@nib/glasses'
import type { Container, Glasses, Made } from './sdk'
import type { View } from './shell'

/** The layer that collects every gesture.
 *
 *  One container per page may capture and it has to be one of ours, so this sits
 *  behind everything with a single space in it. A single space means no overflow,
 *  so a scroll is at both ends of it at once and reaches us instead of scrolling
 *  something invisible; a band with real words in it would swallow the gesture. */
const CAPTURE: Container = { id: 1, name: 'nib' }
const EMPTY = ' '

/** The bands, by the id and name the host matches them on. The host matches the
 *  pair and fails silently when they disagree, so they are said once. */
const IDS: Record<BandName, Container> = {
  head: { id: 2, name: 'nibHead' },
  rule: { id: 3, name: 'nibRule' },
  nums: { id: 4, name: 'nibNums' },
  body: { id: 5, name: 'nibBody' },
  foot: { id: 6, name: 'nibFoot' },
  mic: { id: 7, name: 'nibMic' },
}

/** The order the bands are sent in, which is the order they are read in: a reader
 *  glancing up while a page lands sees the top of it first. */
const ORDER: readonly BandName[] = ['head', 'rule', 'nums', 'body', 'foot', 'mic']

/** What `textContainerUpgrade` will take at once. A page of the firmware's own type
 *  is nowhere near it; an answer from a model could be. */
const MOST = 2000

function container(name: BandName, band: Band, zOrder: number): unknown {
  return {
    containerID: IDS[name].id,
    containerName: IDS[name].name,
    xPosition: band.x,
    yPosition: band.y,
    width: band.width,
    height: band.height,
    isEventCapture: 0,
    zOrderIndex: zOrder,
    content: EMPTY,
    textColor: BRIGHT[name],
  }
}

/** What the page is made of.
 *
 *  `zOrderIndex` is all or nothing for a page, so every container carries one with
 *  the capture layer underneath. The numbers are left out entirely when the reader
 *  has not asked for them, rather than made zero wide: a container that is never
 *  drawn is one fewer thing for the firmware to hold. */
function skeleton(lineNumbers: boolean): unknown {
  const bands = bandsOf(lineNumbers)
  const shown = ORDER.filter((name) => name !== 'nums' || lineNumbers)

  return {
    containerTotalNum: 1 + shown.length,
    textObject: [
      {
        containerID: CAPTURE.id,
        containerName: CAPTURE.name,
        xPosition: 0,
        yPosition: 0,
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        isEventCapture: 1,
        zOrderIndex: 0,
        content: EMPTY,
      },
      ...shown.map((name, at) => container(name, bands[name], at + 1)),
    ],
  }
}

export class Panel {
  /** What each band is showing. A band starts as a single space, so a view whose
   *  band is empty sends nothing at all on the first draw either. */
  private held = new Map<BandName, string>()
  private started = false
  private made: Made = 'unknown'
  /** Which geometry the page was made with, so that a change is noticed. */
  private numbered: boolean

  constructor(
    private readonly glasses: Glasses,
    lineNumbers: boolean,
  ) {
    this.numbered = lineNumbers
  }

  /** Makes the page. Called once a launch: a second `createStartUpPageContainer` is
   *  refused, and refused after blocking for a couple of seconds, so what is
   *  latched is that it was called rather than that it worked.
   *
   *  Answers in the host's own word, because its four answers are not one thing: a
   *  page too big for the panel and a page the radio never heard are both a dark
   *  panel, and only one of them is worth changing anything about. */
  async open(): Promise<Made> {
    if (this.started) return this.made

    this.started = true
    this.made = await this.glasses.start(skeleton(this.numbered))
    return this.made
  }

  /** The reader turned the line numbers on or off, so the body has to move.
   *
   *  The one rebuild in the plugin. Everything on the glass is forgotten with it,
   *  so the next `show` sends every band again. */
  async renumber(lineNumbers: boolean): Promise<boolean> {
    if (lineNumbers === this.numbered) return true

    this.numbered = lineNumbers
    const rebuilt = await this.glasses.rebuild(skeleton(lineNumbers))
    if (rebuilt) this.held = new Map()

    return rebuilt
  }

  /** Puts a view on the glass, sending only the bands whose words have changed.
   *
   *  Answers how many bands went, which is the only honest measure of what a
   *  gesture cost: each is about 83 ms of radio.
   *
   *  One at a time and in reading order. Concurrent sends are the documented way to
   *  wedge the host's channel, and a page that lands top first is a page a reader
   *  can start reading before it has finished arriving. */
  async show(view: View): Promise<number> {
    let sent = 0

    for (const name of ORDER) {
      if (name === 'nums' && !this.numbered) continue

      const words = (view[name] || EMPTY).slice(0, MOST)
      if (this.held.get(name) === words) continue

      const ok = await this.glasses.words(IDS[name], words)
      // A band the host would not take is a band that has not changed, so the next
      // draw tries it again rather than believing a lie about the glass.
      if (ok) this.held.set(name, words)
      sent++
    }

    return sent
  }

  /** Everything on the glass, forgotten. What a page that has come back to the
   *  front needs: the host cleared the panel under us while its own layer was up. */
  forget(): void {
    this.held = new Map()
  }
}
