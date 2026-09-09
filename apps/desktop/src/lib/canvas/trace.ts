/** The last few pointer events, written down.
 *
 *  A stylus is the one thing about this app that cannot be tested from here. Emil's
 *  S Pen reports its barrel button one way in the installed app, another way in
 *  Chrome on Android, and a third way while Samsung's Air actions have hold of it;
 *  the browser is between us and the digitiser and it does not say which. So the
 *  surface keeps a short record of what it was actually handed, in a hidden element
 *  a drive can read and a person on the tablet can be asked for.
 *
 *  Deliberately tiny. A stroke is thousands of events, so only the ones that could
 *  say something new are recorded - a contact arriving or leaving, a button
 *  changing, a gesture being taken away - and a fast line writes nothing at all.
 *  A ring of eight, so the record is the gesture that just happened rather than the
 *  afternoon. */

/** One event, as little of it as says what it was. */
export interface Traced {
  /** down, move, up, cancel, or menu. */
  what: string
  /** What the browser called the pointer. */
  kind: string
  button: number
  buttons: number
  id: number
}

/** How many are kept. Enough to hold a press, a couple of moves and a lift. */
const KEPT = 8

export class Trace {
  private held: Traced[] = []
  /** What the last event of each contact said its buttons were, so a move that
   *  changes nothing is not written down. */
  private was = new Map<number, number>()

  /** An event worth remembering. A move is only worth it when the buttons changed:
   *  everything else about a move is where it is, and where it is is the drawing. */
  note(one: Traced): boolean {
    if (one.what === 'move') {
      if (this.was.get(one.id) === one.buttons) return false
      this.was.set(one.id, one.buttons)
    } else if (one.what === 'down') {
      this.was.set(one.id, one.buttons)
    } else {
      this.was.delete(one.id)
    }

    this.held.push(one)
    if (this.held.length > KEPT) this.held.shift()
    return true
  }

  /** The record, oldest first, as one line: `down/pen b0 B32`. Short enough to read
   *  off a screen and to compare in a test. */
  get line(): string {
    return this.held
      .map((one) => `${one.what}/${one.kind} b${one.button} B${one.buttons}`)
      .join(' | ')
  }
}
