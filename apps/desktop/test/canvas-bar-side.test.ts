import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** A bar docked to a side keeps to its edge, and its panel opens on the inner side of
 *  it (#646). The panel comes before the bar in the markup, so the row has to run from
 *  the inner side: away from a left edge, and the other way round in a right-to-left
 *  language, where a row starts on the right. */

describe('the canvas bar against a side', () => {
  const svelte = readFileSync(
    fileURLToPath(new URL('../src/lib/CanvasBar.svelte', import.meta.url)),
    'utf8',
  )
  const rule = (selector: string) =>
    new RegExp(`(?<!,)\\n  ${selector.replace(/[.()[\]']/g, '\\$&')} \\{([^}]*)\\}`).exec(
      svelte,
    )?.[1] ?? ''

  test('has the panel before the bar', () => {
    expect(svelte.indexOf('class="nib-layer panel"')).toBeLessThan(svelte.indexOf('class="bar"'))
  })

  test('opens the panel to the right of a bar on the left, and to the left of one on the right', () => {
    expect(rule('.cluster.left')).toContain('flex-direction: row-reverse;')
    expect(rule('.cluster.right')).toContain('flex-direction: row;')
  })

  test('and the same sides where a row starts on the right', () => {
    expect(rule(":global([dir='rtl']) .cluster.left")).toContain('flex-direction: row;')
    expect(rule(":global([dir='rtl']) .cluster.right")).toContain('flex-direction: row-reverse;')
  })
})
