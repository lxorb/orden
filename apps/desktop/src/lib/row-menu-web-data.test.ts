import { describe, expect, test, vi } from 'vitest'

const writable = { yes: true }

vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
}))

vi.mock('./sharing/src/api', () => ({
  canShareItem: () => false,
  canWriteAt: () => writable.yes,
  shareThisFile: () => undefined,
}))

const { webDataEntry } = await import('./row-menu')

const SITE = { path: '/s/Svelte docs.url', is_dir: false }

describe('web data', () => {
  test('is offered for a web note that may be written', () => {
    writable.yes = true
    expect(webDataEntry(SITE).map((one) => one?.label)).toEqual(['Web data'])
  })

  test('is not offered in a space shared to be read', () => {
    writable.yes = false
    expect(webDataEntry(SITE)).toEqual([])
  })
})
