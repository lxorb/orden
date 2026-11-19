import { describe, expect, test, vi } from 'vitest'

let picture = ''
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  isDesktop: true,
  invoke: () =>
    Promise.resolve({
      url: 'https://example.test/',
      title: 'Example',
      picture,
      pictureType: 'image/png',
    }),
}))
const { previewOf } = await import('./preview')
describe("a link preview's picture from the server", () => {
  test('is sent on when it is base64', async () => {
    picture = 'AQID'
    const sent: Uint8Array[] = []
    const preview = await previewOf('https://example.test/', (bytes) => {
      sent.push(bytes)
      return Promise.resolve('hash')
    })
    expect(preview?.picture).toBe('hash')
    expect([...(sent[0] ?? [])]).toEqual([1, 2, 3])
  })
  test('is left out when it is not', async () => {
    const sent: Uint8Array[] = []
    for (const one of ['AQI D', 'AQIDB', 'AQ==AQ==', '#!']) {
      picture = one
      const preview = await previewOf('https://example.test/', (bytes) => {
        sent.push(bytes)
        return Promise.resolve('hash')
      })
      expect(preview).toEqual({ url: 'https://example.test/', title: 'Example' })
    }
    expect(sent).toEqual([])
  })
})
