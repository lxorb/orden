import { describe, expect, test } from 'vitest'
import { INK_TOOLS } from './format'
import { ABOUT, MARKS, PEN_ICONS, PEN_NAMES, PLACING, RUBBING, type ToolMark } from './glyphs'
import { BY_ID } from '../shortcuts/registry'

/** The bar is data, so what a test can say about it is what somebody looking at
 *  the bar should be able to say: every button is a Lucide icon, every tool has a
 *  key, and the words on the hover are the words the key is filed under. A button
 *  whose tooltip and whose shortcut row disagree is the bar teaching the wrong
 *  key. */

const TOOLS: ToolMark[] = [...ABOUT, ...RUBBING, ...PLACING]

/** An icon node is a list of [tag, attributes]. Anything else is a helper that
 *  found its way into the map. */
function drawable(icon: unknown): boolean {
  return (
    Array.isArray(icon) &&
    icon.length > 0 &&
    icon.every((one) => Array.isArray(one) && typeof one[0] === 'string' && one.length >= 2)
  )
}

describe('what the bar is drawn from', () => {
  test('every tool on it has an icon that can be drawn', () => {
    for (const mark of TOOLS) expect(drawable(mark.icon), mark.id).toBe(true)
  })

  test('so does every pen, and every mark the panels use', () => {
    for (const tool of INK_TOOLS) expect(drawable(PEN_ICONS[tool]), tool).toBe(true)
    for (const [name, icon] of Object.entries(MARKS)) expect(drawable(icon), name).toBe(true)
  })

  test('no two of them are the same icon, so no two buttons look alike', () => {
    const seen = [...TOOLS.map((one) => one.icon), ...Object.values(PEN_ICONS)]
    expect(new Set(seen).size).toBe(seen.length)
  })

  test('every tool says something, in words, for a hover and a screen reader', () => {
    for (const mark of TOOLS) expect(mark.title().length, mark.id).toBeGreaterThan(0)
    for (const tool of INK_TOOLS) expect(PEN_NAMES[tool]().length, tool).toBeGreaterThan(0)
  })
})

describe('the key the bar teaches', () => {
  test('is a key the shortcut registry holds', () => {
    for (const mark of TOOLS) {
      expect(mark.key, mark.id).not.toBeNull()
      expect(BY_ID.has(mark.key ?? ''), mark.id).toBe(true)
    }
  })

  /** The words are in two places because the bar shows a mark and the settings
   *  show a row, and this is what keeps them one answer. */
  test('is filed in the registry under the same words the button says', () => {
    for (const mark of TOOLS) {
      const entry = BY_ID.get(mark.key ?? '')
      expect(entry?.label(), mark.id).toBe(mark.title())
    }
  })

  test('is a canvas key, and one meant for the plane in front rather than the app', () => {
    for (const mark of TOOLS) {
      const entry = BY_ID.get(mark.key ?? '')
      expect(entry?.category, mark.id).toBe('canvas')
      expect(entry?.contextual, mark.id).toBe(true)
    }
  })
})
