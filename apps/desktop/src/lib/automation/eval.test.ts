import { describe, expect, test, vi } from 'vitest'

vi.mock('../link-index.svelte', () => ({ links: { name: 'links' } }))
vi.mock('../search.svelte', () => ({ search: {} }))
vi.mock('../settings.svelte', () => ({ settings: {} }))
vi.mock('../platform/src/tauri', () => ({ invoke: () => Promise.resolve(null) }))
vi.mock('../workspace.svelte', () => ({ workspace: {} }))
vi.mock('../web-tab/pages.svelte', () => ({ pages: {} }))

const { evaluate } = await import('./eval')

describe('a script run with eval', () => {
  test('reaches the app as orden, and as nib for the scripts written before', async () => {
    expect(await evaluate('orden.links.name')).toBe('links')
    expect(await evaluate('nib.links.name')).toBe('links')
    expect(await evaluate('return orden === nib')).toBe(true)
  })
})
