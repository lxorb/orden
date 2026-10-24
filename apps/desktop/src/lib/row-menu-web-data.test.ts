import { describe, expect, test, vi } from 'vitest'

/** Web data, offered for a web note's row and its tab, in a space shared to be read.
 *
 *  Both of its choices write the note's file - Separate puts an id of its own into it,
 *  Global takes it out - and a space shared to be read is one nothing may be written
 *  in (B288). So it is not offered there, in the row's menu or the tab's, which both
 *  draw it from `webDataEntry`. The desktop app's alone, so this test is that build. */

const writable = { yes: true }

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
}))

vi.mock('./sharing.svelte', () => ({
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
