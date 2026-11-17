import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { registerSidebarPart } from '@orden/contracts'
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../surfaces/src/api', () => ({ showFeedback: () => undefined }))

const { Sidebar, SidebarFoot } = await import('../src/api')

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const LIB = join(HERE, '..')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

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
  test('hands the app its sides and the pass window its foot', () => {
    expect(typeof Sidebar).toBe('function')
    expect(typeof SidebarFoot).toBe('function')
  })

  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = own.pending ?? []
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

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
