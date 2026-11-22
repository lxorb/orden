import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
describe('hint cards', () => {
  test('are drawn nowhere: no component wears the hint bubble and no module keeps hints', () => {
    const drawn = readdirSync(LIB, { recursive: true, encoding: 'utf8' }).filter(
      (one) => one.endsWith('.svelte') && /class="orden-bubble[^"]*\bhint\b/.test(readFileSync(join(LIB, one), 'utf8')),
    )
    expect(drawn).toEqual([])
    expect(existsSync(join(LIB, 'hints'))).toBe(false)
  })
})
describe('the rows of every sidebar view (#2487)', () => {
  const VIEWS = {
    files: 'sidebar/src/Tree.svelte',
    outline: 'sidebar/src/Sidebar.svelte',
    chats: 'chats-client/src/view/ChatsPanel.svelte',
    todos: 'tasks-views/src/TodoRow.svelte',
    links: 'links-panel/src/HitList.svelte',
    search: 'search/src/SearchPanel.svelte',
    time: 'time/src/TimePanel.svelte',
  }
  test('wear the shared row, so they light, press and stay chosen as a note row does', () => {
    const own = Object.entries(VIEWS).flatMap(([view, file]) => {
      const source = readFileSync(join(LIB, file), 'utf8')
      const style = source.slice(source.lastIndexOf('<style'))
      const shared = /class="[^"]*\borden-row\b/.test(source)
      const restyled = /orden-row[^{]*:hover|:hover[^{]*orden-row/.test(style)
      return shared && !restyled ? [] : [`${view}: ${shared ? 'restyles the hover' : 'has no shared row'}`]
    })
    expect(own).toEqual([])
  })
})
