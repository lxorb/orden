import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Which sections Settings lists, as far as which device it is on decides.
 *
 *  The Mobile section is a phone's and a tablet's: the bar over the keyboard and the
 *  pull past the top of a list are drawn nowhere else. A reader on a NixOS laptop:
 *  *"I am on the laptop but I see mobile tab, should it be hidden?"* (#769). */

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: () => Promise.resolve(null),
}))

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (at) => [...held.keys()][at] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { modes } = await import('../modes.svelte')
const { viewport } = await import('../viewport.svelte')
const { sectionGroups } = await import('./sections')

const listed = () =>
  sectionGroups()
    .flat()
    .map((one) => one.id)

beforeEach(() => {
  viewport.device = 'desktop'
  modes.mobileSeen = false
})

describe('the Mobile section', () => {
  test('is not offered on a laptop whose account has never been on a phone', () => {
    expect(listed()).not.toContain('mobile')
    // And the rest are where they were.
    expect(listed()).toContain('shortcuts')
    expect(listed()).toContain('spelling')
  })

  test('is offered on a phone and on a tablet', () => {
    viewport.device = 'phone'
    expect(listed()).toContain('mobile')
    viewport.device = 'tablet'
    expect(listed()).toContain('mobile')
  })

  /** Still put together on the desktop, with a keyboard, once there is a phone on the
   *  account to put it together for. */
  test('is offered on a laptop once the account has been on a phone', () => {
    modes.mobileSeen = true
    expect(listed()).toContain('mobile')
    expect(listed().indexOf('mobile')).toBe(listed().indexOf('shortcuts') + 1)
  })
})
