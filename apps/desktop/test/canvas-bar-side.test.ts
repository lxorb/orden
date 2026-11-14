import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('the canvas bar against a side', () => {
  const svelte = readFileSync(
    join(import.meta.dirname, '../src/lib/canvas/src/CanvasBar.svelte'),
    'utf8',
  )
  const rule = (selector: string) =>
    new RegExp(`(?<!,)\\n  ${selector.replace(/[.()[\]']/g, '\\$&')} \\{([^}]*)\\}`).exec(
      svelte,
    )?.[1] ?? ''

  test('has the panel before the bar', () => {
    expect(svelte.indexOf('class="orden-layer panel"')).toBeLessThan(svelte.indexOf('class="bar"'))
  })

  test('opens the panel to the right of a bar on the left, and to the left of one on the right', () => {
    expect(rule('.cluster.left')).toContain('flex-direction: row-reverse;')
    expect(rule('.cluster.right')).toContain('flex-direction: row;')
  })
})
