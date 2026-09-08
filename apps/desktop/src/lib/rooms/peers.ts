/** Who else is in a note, and where.
 *
 *  What travels is a name, an accent and two positions. The positions are Yjs's
 *  own relative ones rather than offsets: a caret that says "after this character"
 *  is still in the right place once somebody has written a paragraph above it,
 *  where a number would have slid. Each end turns them back into offsets against
 *  the text it holds, which is why nobody has to agree about anything but the
 *  characters themselves.
 *
 *  The accent travels as its name, not as a colour. The shade a colour needs to
 *  be readable on white is not the shade it needs on black, so which shade is
 *  the reader's business and not the writer's; see accents.ts. */

import type { Peer } from '@nib/editor'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { accentColour } from '../accents'
import { isRecord, isString } from '../stored'

/** What one device says about itself. Everything in it is JSON, because that is
 *  what the awareness protocol carries.
 *
 *  Both names travel, and which one is drawn is decided here rather than by the
 *  device that sent them: a caret answers a different question depending on who
 *  else is in the note. Two of one person's own machines want to be told apart
 *  by machine - "Emil" on both of them says nothing - while two people want to
 *  be told apart by person. Nobody knows which case it is until everybody has
 *  arrived, so the choice belongs to whoever is looking. */
interface Presence {
  who: {
    /** The device: "Windows", "iPhone", "Firefox". */
    name: string
    accent: string
    /** Whoever is at it, when there is an account to say. */
    person?: string
  }
  /** Absent until the caret has been somewhere. */
  caret?: { anchor: unknown; head: unknown }
}

/** Where a caret is, as something that survives the text changing under it. */
export function relative(text: Y.Text, at: number): unknown {
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, at))
}

/** And back again, against the text this device holds. Null when the position
 *  cannot be placed - a caret in a paragraph that has since gone. */
function absolute(doc: Y.Doc, held: unknown): number | null {
  const found = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(held),
    doc,
  )

  return found ? found.index : null
}

function presenceOf(value: unknown): Presence | null {
  if (!isRecord(value) || !isRecord(value.who)) return null
  if (!isString(value.who.name) || !isString(value.who.accent)) return null

  const who = {
    name: value.who.name,
    accent: value.who.accent,
    ...(isString(value.who.person) ? { person: value.who.person } : {}),
  }
  if (!isRecord(value.caret)) return { who }

  return { who, caret: { anchor: value.caret.anchor, head: value.caret.head } }
}

/** Everybody in the room but us, as the editor draws them. A device that has
 *  announced itself without having put its caret anywhere yet is somebody in the
 *  note rather than somebody with a caret in it, so it counts towards the dots on
 *  the tab and draws nothing in the text. */
export function peersIn(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { present: number; carets: Peer[] } {
  const here: { id: number; presence: Presence }[] = []

  for (const [id, state] of awareness.getStates()) {
    if (id === doc.clientID) continue

    const presence = presenceOf(state)
    if (presence) here.push({ id, presence })
  }

  // Our own counts: a note this account has open on two machines and somebody
  // else has open on one is a room with two people in it.
  const people = new Set(
    [presenceOf(awareness.getLocalState()), ...here.map((one) => one.presence)]
      .map((one) => one?.who.person)
      .filter((one): one is string => !!one),
  )
  const byPerson = people.size > 1

  const carets: Peer[] = []

  for (const { id, presence } of here) {
    if (!presence.caret) continue

    const head = absolute(doc, presence.caret.head)
    const anchor = absolute(doc, presence.caret.anchor)
    if (head === null) continue

    carets.push({
      id,
      name: (byPerson ? presence.who.person : presence.who.name) ?? presence.who.name,
      colour: accentColour(presence.who.accent, scheme),
      head,
      anchor: anchor ?? head,
    })
  }

  return { present: here.length, carets }
}
