import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SHEET = readFileSync(
  fileURLToPath(new URL('../../themes/src/editor.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

function body(css: string, selector: string): string {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
    (match[1] ?? '')
      .split(',')
      .map((one) => one.trim())
      .includes(selector),
  )
  return found.map((match) => match[2] ?? '').join(';')
}

function touchOnly(css: string): string {
  const start = css.indexOf('@media (hover: none)', css.indexOf('.orden-block-handle svg'))
  return css.slice(start, css.indexOf('\n}\n', start))
}

describe('the reach of the block handle (#2034)', () => {
  test('the line reaches out over the gap to the handle, so the pointer crossing it keeps the line hovered', () => {
    const bridge = body(SHEET, '.orden-block-slot::before')
    expect(bridge).toMatch(/content\s*:/)
    expect(bridge).toMatch(/position\s*:\s*absolute/)
    expect(bridge).toMatch(/inset-inline-end\s*:\s*0\b/)
    expect(bridge).toMatch(
      /inline-size\s*:\s*calc\(var\(--space-5\) \+ var\(--line-inset, 0px\) \+ 15px\)/,
    )
  })

  test('the handle lingers a moment after the pointer leaves, and shows again at once', () => {
    const resting = body(SHEET, '.orden-block-handle')
    expect(resting).toMatch(/opacity var\(--dur-fast\) var\(--ease-out\) [1-9]\d*ms/)

    const shown = body(SHEET, '.cm-line:hover > .orden-block-slot .orden-block-handle')
    expect(shown).toMatch(/opacity\s*:\s*1/)
    expect(shown).toMatch(/transition-delay\s*:\s*0s/)
  })

  test('a finger, which has no handle, gets no reach either', () => {
    expect(touchOnly(SHEET)).toMatch(/\.orden-block-slot::before[^{]*\{[^}]*display\s*:\s*none/)
  })
})
