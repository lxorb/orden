import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerSidebarPart } from '@orden/contracts'
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../surfaces/src/api', () => ({ showFeedback: () => undefined }))

const { SidebarFoot } = await import('../src/api')

const HERE = join(import.meta.dirname, '..')
const LIB = join(HERE, '..')

const own = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
  dependsOn: string[]
  pending?: string[]
}

function layerOf(name: string): string | null {
  const file = join(LIB, name, 'module.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { layer: string }).layer
}

describe('the sidebar', () => {
  test('it leans on no content or feature module, which reach it through sidebar parts', () => {
    const higher = own.dependsOn.filter((name) => {
      const layer = layerOf(name)
      return layer === 'content' || layer === 'features'
    })
    expect(higher).toEqual([])
  })

  test('its foot holds feedback and the settings, and on a desktop leaves a registered scratchpad to the right side', () => {
    const taken = registerSidebarPart({ id: 'scratchpad', open: () => true })
    const html = render(SidebarFoot).body
    taken()
    expect(html).toContain('aria-label="Send feedback"')
    expect(html).toContain('aria-label="Settings"')
    expect(html).not.toContain('aria-label="Scratchpad"')
  })
})
