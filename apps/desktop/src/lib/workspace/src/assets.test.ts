import { describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

const api = vi.hoisted(() => ({ BASE: '' }))
vi.mock('../../accounts/src/client', () => ({
  api: {},
  get BASE() {
    return api.BASE
  },
}))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: async (command: string, args?: { name?: string }) => {
    if (command === 'save_asset') return `assets/${args?.name ?? ''}`
    if (command === 'scan_links') {
      const { scanNote } = await import('@orden/scan/note')
      return { notes: [scanNote('Work/Plan.md', '# Plan\n')], files: [] }
    }
    return null
  },
}))
vi.stubGlobal('location', { href: 'https://orden.so/s/notes' })
vi.stubGlobal('localStorage', memoryStorage())
const { accountAddress, storeImage } = await import('./assets')
const { workspace } = await import('./workspace.svelte')
const { links } = await import('../../link-index/src/api')
const { startup } = await import('../../launch/src/api')
void startup.shown()
describe('a picture the account keeps', () => {
  test('is named by its whole address, on the web app as on the desktop', () => {
    api.BASE = ''
    expect(accountAddress('/i/ab12.png')).toBe('https://orden.so/i/ab12.png')
    api.BASE = 'https://orden.so'
    expect(accountAddress('https://orden.so/i/ab12.png')).toBe('https://orden.so/i/ab12.png')
  })
  test('and one kept in the space is not the account’s', () => {
    api.BASE = ''
    expect(accountAddress('assets/ab12.png')).toBeNull()
    api.BASE = 'https://orden.so'
    expect(accountAddress('/i/ab12.png')).toBeNull()
    expect(accountAddress('Notes/assets/ab12.png')).toBeNull()
  })
})
describe('a picture stored beside a note', () => {
  test('is known to the link index at once, so a copy right after keeps it', async () => {
    api.BASE = ''
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/s' }]
    await links.build('/s')
    const src = await storeImage(
      new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }),
      '/s/Work/Plan.md',
    )
    expect(src).toMatch(/^assets\/[0-9a-f]{16}\.png$/)
    expect(links.rebased(`![](${src ?? ''})\n`, '/s/Work/Plan.md', '/s/Plan.md')).toBe(`![](Work/${src ?? ''})\n`)
  })
})
