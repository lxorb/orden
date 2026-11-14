import { beforeEach, describe, expect, test, vi } from 'vitest'

const calls: { command: string; args: Record<string, unknown> }[] = []

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args: args ?? {} })
    return Promise.resolve(undefined)
  },
}))

const { pages } = await import('./pages.svelte')
const { workspace } = await import('../../workspace.svelte')
const { zoomStep } = await import('./zoom')

beforeEach(() => {
  calls.length = 0
})

describe('a rung of the zoom', () => {
  test('goes to the next one and tells the engine', () => {
    const page = pages.of('a')
    page.live = true
    page.url = 'https://example.com/'

    zoomStep('a', page, 'in')
    expect(page.zoom).toBe(1.1)
    expect(calls.at(-1)).toEqual({ command: 'web_zoom', args: { tab: 'a', factor: 1.1 } })

    zoomStep('a', page, 'reset')
    expect(page.zoom).toBe(1)
  })
})

describe('the rows that size a page or a note', () => {
  test('with no page in front they are the words', () => {
    vi.spyOn(workspace, 'active', 'get').mockReturnValue(null)
    expect(workspace.zoomPage('in')).toBe(false)
  })

  test('with a page in front they are the page', async () => {
    const page = pages.of('b')
    page.live = true
    page.url = 'https://example.com/'
    vi.spyOn(workspace, 'active', 'get').mockReturnValue({
      id: 'b',
      kind: 'web',
    } as unknown as typeof workspace.active)

    expect(workspace.zoomPage('out')).toBe(true)
    await vi.waitFor(() => expect(page.zoom).toBe(0.9))
  })

  test('with a tab that has no page yet they are the words', () => {
    pages.of('c').live = false
    vi.spyOn(workspace, 'active', 'get').mockReturnValue({
      id: 'c',
      kind: 'web',
    } as unknown as typeof workspace.active)

    expect(workspace.zoomPage('in')).toBe(false)
  })
})
