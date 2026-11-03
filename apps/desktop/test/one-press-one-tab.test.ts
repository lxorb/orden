import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** One press on a link is one tab (#1083). A press reaches two takers when the surface
 *  follows it and something else is let have it as well: the browser engine's own
 *  default for an `<a>` (a modifier or the middle button is "open in a new window"),
 *  or, in a terminal, the program that asked for the mouse. So every surface that
 *  follows a link out of a press spends the press first, and the terminal takes a link
 *  press before xterm.js does. test/effects/terminal-links.effect.test.ts presses one;
 *  this holds every other surface to the same rule where it is written. */

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

/** Every call that follows a link out of the press it was handed. */
const pressed = files(SRC).flatMap((path) => {
  const text = readFileSync(path, 'utf8')
  return [...text.matchAll(/followHref\([^)]*\bevent\)/g)].map((one) => ({
    path: path.slice(SRC.length + 1),
    before: text.slice(Math.max(0, one.index - 1200), one.index),
  }))
})

describe('one press, one tab', () => {
  test('there are surfaces that follow a link out of a press', () => {
    expect(pressed.length).toBeGreaterThan(4)
  })

  test('every one spends the press before following it', () => {
    for (const one of pressed) {
      // The nearest function above the call, and what it does before the call.
      const body = one.before.slice(one.before.lastIndexOf('function ') + 1)
      const inline = one.before.slice(one.before.lastIndexOf('=>'))
      expect(
        body.includes('.preventDefault()') || inline.includes('.preventDefault()'),
        one.path,
      ).toBe(true)
    }
  })

  test('the terminal follows a link from the press, never from xterm.js as well', () => {
    const session = readFileSync(join(SRC, 'lib/terminal/sessions.svelte.ts'), 'utf8')
    const links = readFileSync(join(SRC, 'lib/terminal/links.ts'), 'utf8')
    expect(session).toMatch(
      /addEventListener\('mousedown', \(event\) => this\.pressLink\(event\), true\)/,
    )
    expect(session).toMatch(/linkHandler: \{\s*activate: \(\) => undefined,/)
    expect(links).toMatch(/activate: \(\) => undefined,/)
    expect(session.match(/workspace\.openPage\(/g)).toHaveLength(1)
  })
})
