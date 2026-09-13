import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Every button the editor draws into a note answers a key as well as a mouse.
 *
 *  The buttons in a note are pressed on `mousedown` with the default stopped, so
 *  that pressing one does not move the caret out of the line it is in. That is
 *  the right gesture for a mouse and it is the whole of what these buttons had:
 *  Tab to the Run glyph, to Copy code, to any of the twelve buttons around a
 *  table, to the card an embed draws - each takes the focus, wears the ring
 *  base.css puts on everything a key can land on, says its name to a reader
 *  listening - and Enter did nothing at all.
 *
 *  A `<button>` in the tab order with a name on it is a promise. So: `pressedByKey`
 *  beside the mousedown, in one place, and this is what says so if a ninth button
 *  is added without it.
 *
 *  A button deliberately out of the tab order is not one of these. The block's
 *  grip and a fold's hinge both set `tabIndex = -1` - every foldable block would
 *  otherwise be a stop on the way through a note - and the keyboard reaches what
 *  they do through a command instead. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

const files = sourceFiles(SOURCE).map((path) => ({
  name: path.slice(SOURCE.length).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

/** Whether the file takes its buttons out of the tab order rather than leaving
 *  them in it. */
function outOfTheTabOrder(text: string): boolean {
  return text.includes('tabIndex = -1')
}

describe('a button the editor draws into a note', () => {
  test('the scan finds the files', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  test('is pressed by a key as well as by a mouse', () => {
    const deaf = files
      .filter((one) => one.text.includes("createElement('button')"))
      .filter((one) => !outOfTheTabOrder(one.text))
      .filter((one) => !/pressedByKey|addEventListener\('click'/.test(one.text))
      .map((one) => one.name)

    expect(deaf, `these draw a button no key can press: ${deaf.join(', ')}`).toEqual([])
  })

  test('and says so in one place rather than in eight', () => {
    const own = files.filter((one) => one.text.includes('export function pressedByKey'))
    expect(own.map((one) => one.name)).toEqual(['press.ts'])
  })
})
