import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Settings that change how the text is shaped - its size, its line height,
 *  the width of the column - all work by writing a CSS custom property. A
 *  custom property is invisible to CodeMirror: it measures the line height and
 *  character width once and then trusts them.
 *
 *  Those cached numbers place the caret and decide which line a click lands
 *  on, so a stale one puts every position out by a little, and the error adds
 *  up with every line down the document. Zoom is persisted, so it survives
 *  restarts and looks like the editor is simply broken.
 *
 *  Anything that writes such a property has to say so, which is what
 *  `remeasure` is for. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** The body of each function that writes a CSS custom property. */
function writersOf(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []

  for (const match of source.matchAll(/export function (\w+)\(([\s\S]*?)\n\}/g)) {
    const [, name, body] = match
    if (body.includes("setProperty('--")) out.push({ name, body })
  }

  return out
}

describe('settings that change the shape of the text', () => {
  const modes = read('../src/modes.ts')

  test('the scan finds them', () => {
    expect(writersOf(modes).map((one) => one.name).sort()).toEqual(['setLineHeight', 'setMeasure'])
  })

  test('every one tells the editor to measure again', () => {
    const silent = writersOf(modes)
      .filter((one) => !one.body.includes('remeasure('))
      .map((one) => one.name)

    expect(silent, `these would leave the caret misplaced: ${silent}`).toEqual([])
  })

  test('remeasure exists and guards a torn-down view', () => {
    expect(modes).toContain('export function remeasure')
    expect(modes).toContain('view.dom.isConnected')
  })
})
