import { describe, expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'

const writable = { yes: true }

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  isDesktop: true,
}))

vi.mock('../../sharing/src/api', () => ({
  canShareItem: () => false,
  canWriteAt: () => writable.yes,
  shareThisFile: () => undefined,
}))

const shown: string[] = []
providePort('web.sites', {
  dropped: () => Promise.resolve(null),
  showData: (path) => Promise.resolve(void shown.push(path)),
})

const { webDataEntry } = await import('./api')

const SITE = { path: '/s/Svelte docs.url', is_dir: false }

describe('web data', () => {
  test('is offered for a web note that may be written', () => {
    writable.yes = true
    const entries = webDataEntry(SITE)
    expect(entries.map((one) => one?.label)).toEqual(['Web data'])
    entries[0]?.run()
    expect(shown).toEqual([SITE.path])
  })

  test('is not offered in a space shared to be read', () => {
    writable.yes = false
    expect(webDataEntry(SITE)).toEqual([])
  })
})
