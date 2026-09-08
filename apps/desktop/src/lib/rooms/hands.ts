/** Whose hand is on the plane, where, and what it is drawing.
 *
 *  The canvas's answer to a caret. A note's carets say where in the words somebody
 *  is; a plane has no words, so what travels is where on the plane the pointer is
 *  and, while a pen is down, the stroke it is in the middle of. So the line appears
 *  as it is being drawn rather than at the moment the pen lifts, which is the whole
 *  difference between watching somebody write and being handed what they wrote.
 *
 *  Over awareness rather than in the document, deliberately. An unfinished stroke
 *  is not on the plane yet: it is not in the file, it is nobody's to undo, and it
 *  vanishes if the pen is lifted somewhere else. Awareness is what a room already
 *  has for facts that belong to a device rather than to the file, and it is thrown
 *  away when that device goes. The finished stroke goes into the document on the
 *  pen lift, once, as one whole object.
 *
 *  Sent packed, exactly as a file packs points: a hundred samples a second becomes
 *  six numbers a sample rather than an object each. */

import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { packed, unpacked } from '@nib/markdown/canvas'
import { accentColour } from '../accents'
import { type InkStroke, isInkTool } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { Hand } from '../canvas/shared'
import { isRecord, isString } from '../stored'
import { whoElse } from './peers'

/** The field a device's hand travels in. */
export const HAND = 'hand'

/** What this device says about its hand: where it is, and the stroke it is in the
 *  middle of. Built here rather than at the call site so the shape it travels in
 *  is written down once. */
export function saidHand(at: Point, drawing: InkStroke | null): Record<string, unknown> {
  return {
    x: Math.round(at.x * 10) / 10,
    y: Math.round(at.y * 10) / 10,
    ...(drawing
      ? {
          ink: {
            tool: drawing.tool,
            color: drawing.color,
            size: drawing.size,
            points: packed(drawing.points),
          },
        }
      : {}),
  }
}

/** The stroke a hand is drawing, out of what it said. Null for anything that does
 *  not read as one: a hand with the pen up, or a field written by a newer build. */
function inkIn(value: unknown, id: number): InkStroke | null {
  if (!isRecord(value)) return null
  if (!isInkTool(value.tool) || !isString(value.color)) return null
  if (typeof value.size !== 'number' || !Array.isArray(value.points)) return null

  const points = unpacked(value.points.filter((one): one is number => typeof one === 'number'))
  if (points.length < 2) return null

  return {
    // Not an id off the wire: a live stroke is nobody's object yet, and giving it
    // the sender's own id would let it be picked or erased here.
    id: `hand:${id}`,
    tool: value.tool,
    color: value.color,
    size: value.size,
    points,
  }
}

/** Everybody on the plane but us: how many, and the hands there are to draw.
 *
 *  A device that has joined without moving its pointer is somebody on the plane
 *  rather than a hand on it, so it counts towards the dots on the tab and draws
 *  nothing, which is exactly how a note treats somebody with no caret yet. */
export function handsIn(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { present: number; hands: Hand[] } {
  const { here, nameOf } = whoElse(awareness, doc)
  const hands: Hand[] = []

  for (const { id, who, said } of here) {
    const hand = said[HAND]
    if (!isRecord(hand) || typeof hand.x !== 'number' || typeof hand.y !== 'number') continue

    hands.push({
      id,
      name: nameOf(who),
      colour: accentColour(who.accent, scheme),
      at: { x: hand.x, y: hand.y },
      stroke: inkIn(hand.ink, id),
    })
  }

  return { present: here.length, hands }
}
