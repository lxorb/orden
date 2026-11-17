import { afterEach, expect, test, vi } from 'vitest'

function press(key: string, held: { ctrl?: boolean; meta?: boolean }) {
  let prevented = false
  const event = {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: held.ctrl ?? false,
    metaKey: held.meta ?? false,
    shiftKey: false,
    altKey: false,
    get defaultPrevented() {
      return prevented
    },
    preventDefault: () => {
      prevented = true
    },
  }
  return event as unknown as KeyboardEvent
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test.each([
  ['Macintosh; Intel Mac OS X 10_15_7', { meta: true }],
  ['Windows NT 10.0; Win64; x64', { ctrl: true }],
  ['X11; Linux x86_64', { ctrl: true }],
])(
  'the app’s own key reloads Orden, as no webview does it on every system (%s)',
  async (agent, held) => {
    vi.stubGlobal('navigator', { userAgent: `Mozilla/5.0 (${agent})` })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const { shortcuts } = await import('./shortcuts.svelte')

    const event = press('r', held)
    expect(shortcuts.handle(event, {} as never)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  },
)
