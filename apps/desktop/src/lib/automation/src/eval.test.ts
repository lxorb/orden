import { describe, expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'

vi.mock('../../link-index/src/api', () => ({ links: { name: 'links' } }))
vi.mock('../../search.svelte', () => ({ search: {} }))
vi.mock('../../settings.svelte', () => ({ settings: {} }))
vi.mock('../../platform/src/tauri', () => ({ invoke: () => Promise.resolve(null) }))
vi.mock('../../workspace/src/api', () => ({ workspace: {} }))

const { evaluate } = await import('./eval')

describe('a script run with eval', () => {
  test('reaches the app as orden, and as nib for the scripts written before', async () => {
    expect(await evaluate('orden.links.name')).toBe('links')
    expect(await evaluate('nib.links.name')).toBe('links')
    expect(await evaluate('return orden === nib')).toBe(true)
  })

  test('hands the script the web pages the web tab gives, as they are', async () => {
    const pages = { of: () => ({ url: 'https://orden.so/' }) }
    const stop = providePort('web.scripts', { pages })
    expect(await evaluate('orden.pages.of().url')).toBe('https://orden.so/')
    stop()
  })
})
