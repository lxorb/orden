import { describe, expect, test, vi } from 'vitest'

const asked = vi.hoisted((): string[] => [])

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', language: 'en' })

vi.mock('../src/lib/platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  platform: () => 'linux',
  invoke: (command: string) => {
    asked.push(command)
    if (command === 'gpu_chosen') return Promise.resolve(true)
    if (command === 'gpu_line') return Promise.resolve('A card')
    return Promise.reject(new Error('no crate'))
  },
}))

const { preferences } = await import('../src/lib/settings/src/preferences')
const { search } = await import('../src/lib/settings/src/settings-search')
await import('../src/lib/web-tab/src/api')
await (await import('@orden/contracts')).registered()

const found = (query: string) =>
  search(query, preferences(), []).map((hit) => (hit.kind === 'field' ? hit.field.label : ''))

describe('the Browser rows', () => {
  test('are found by a search, like every other row', () => {
    expect(found('search engine')).toContain('Search engine')
  })

  test('but not the address of a custom engine while none is chosen', () => {
    expect(found('search address')).toEqual([])
  })
})

describe('the hardware acceleration row', () => {
  test('asks the graphics state once, however often the panes are built', async () => {
    for (let pass = 0; pass < 5; pass++) preferences()
    await vi.waitFor(() => expect(asked).toContain('gpu_line'))
    expect(asked.filter((one) => one === 'gpu_chosen')).toHaveLength(1)
  })
})
