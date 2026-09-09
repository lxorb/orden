/** What each pointer on the glass said about itself, and what has changed since.
 *
 *  A contact is not always what it claims when it lands. Samsung's S Pen reports
 *  the first event of a contact as a finger on some devices, and a barrel button
 *  held as the nib touches down is sometimes only in the second event. Both are the
 *  same shape of problem: the surface acted on what it was told, and a moment later
 *  it is told something else that would have meant a different gesture.
 *
 *  So the surface keeps what each contact claimed here and asks, on every move,
 *  whether that claim has changed in a way worth taking the gesture back for.
 *  Answered once: a stroke is not restarted on every event of a drag just because
 *  the pen is still a pen. */

export interface Contact {
  /** Whether the event says pen. */
  pen: boolean
  /** Whether the pen's button is down, which rubs out. */
  eraser: boolean
}

/** The bit Chromium sets for a stylus held with its button, on a desktop. */
const ERASER_BIT = 32
/** The bit for the right mouse button, which is what Chrome on Android reports the
 *  same barrel button as. */
const RIGHT_BIT = 2

/** As much of a pointer event as saying what kind of pointer it is needs. */
export interface Reported {
  pointerType: string
  button: number
  buttons: number
}

/** What the glass is like under this event: whether a pen has ever been on it, and
 *  whether it is a screen a finger uses. */
export interface Glass {
  penSeen: boolean
  touch: boolean
}

/** What kind of pointer this really is, and whether it is rubbing out.
 *
 *  Three shapes of the same fact, all of them seen on the same Samsung tablet:
 *
 *  - a pen that says pen, with the eraser bit set, which is Chromium on a desktop;
 *  - a pen that says pen, with the right button bit set, which is Chrome on
 *    Android, where the barrel button is reported as the right mouse button;
 *  - a pen that says **mouse** while the button is held, which some builds do,
 *    because a stylus with a button pressed looks like a mouse to the layer
 *    underneath.
 *
 *  The third is only believed on a touch screen that has had a pen on it. A desktop
 *  right click is a desktop right click, and turning it into an eraser because
 *  somebody once drew with a stylus would take the menu away for good.
 *
 *  Pure, so all three shapes are a test rather than a tablet. */
export function penKind(
  event: Reported,
  glass: Glass,
): { kind: 'mouse' | 'pen' | 'touch'; eraser: boolean } {
  const held = (event.buttons & ERASER_BIT) !== 0 || (event.buttons & RIGHT_BIT) !== 0
  const asked = event.button === 2 || event.button === 5

  if (event.pointerType === 'pen') return { kind: 'pen', eraser: held || asked }
  if (event.pointerType === 'touch') return { kind: 'touch', eraser: false }

  // A mouse that is really the pen, on glass that has had one on it.
  if (glass.penSeen && glass.touch && (held || asked)) return { kind: 'pen', eraser: true }

  return { kind: 'mouse', eraser: false }
}

/** What a changed claim comes to. */
export interface Turned {
  eraser: boolean
  /** Whether this is the first the surface has heard that the contact is a pen,
   *  which is also what makes the glass remember it has seen one. */
  first: boolean
}

export class Contacts {
  private readonly held = new Map<number, Contact>()

  /** A pointer that has landed, and what it said. */
  came(id: number, one: Contact) {
    this.held.set(id, one)
  }

  /** A pointer that has left. */
  went(id: number) {
    this.held.delete(id)
  }

  /** Whether this event means the contact is a pen after all, or that a pen's
   *  button has come down since it landed. Nothing for a contact nobody is holding,
   *  for a finger, and for a pen that is already known to be one.
   *
   *  Remembers what it answered, so the second event of the same stroke says
   *  nothing. */
  turned(id: number, now: Contact): Turned | null {
    const was = this.held.get(id)
    if (!was || !now.pen) return null
    if (was.pen && (!now.eraser || was.eraser)) return null

    this.held.set(id, now)
    return { eraser: now.eraser, first: !was.pen }
  }
}
