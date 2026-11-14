import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { type InkStroke, packed, strokeOf } from '@orden/markdown/canvas'
import { accentColour } from '../../theme/src/api'
import { type Hand, type Point } from '@orden/markdown/plane'
import { isRecord } from '../../platform/src/api'
import { type Seen, whoElse } from './peers'

export const HAND = 'hand'

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
            ...(drawing.opacity === undefined ? {} : { opacity: drawing.opacity }),
            points: packed(drawing.points),
          },
        }
      : {}),
  }
}

function inkIn(value: unknown, id: number): InkStroke | null {
  if (!isRecord(value)) return null

  return strokeOf({ ...value, id: `hand:${id}` })
}

export function handsIn(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { present: number; hands: Hand[]; seen: Seen } {
  const { here, nameOf, seen } = whoElse(awareness, doc, scheme)
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

  return { present: here.length, hands, seen }
}
