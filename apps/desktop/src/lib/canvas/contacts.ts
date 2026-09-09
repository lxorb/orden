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
