import { beforeEach, describe, expect, test, vi } from 'vitest'

const writeNow = vi.fn(() => Promise.resolve())
const front = {
  active: { id: 'tab', note: { path: '/s/a.md' as string | null, shared: null, kind: 'note' } },
}
vi.mock('./workspace.svelte', () => ({
  workspace: {
    writeNow,
    fileOps: { follow: () => () => undefined },
    get active() {
      return front.active
    },
  },
}))

const askPlace = vi.fn()
vi.mock('./save-place/ask', () => ({ askPlace }))

vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

const { shortcuts } = await import('./shortcuts.svelte')

function press(key: string, held: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  let prevented = false
  const event = {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: held.ctrl ?? false,
    metaKey: held.meta ?? false,
    shiftKey: held.shift ?? false,
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

beforeEach(() => {
  writeNow.mockClear()
  askPlace.mockClear()
  front.active.note.path = '/s/a.md'
  front.active.note.kind = 'note'
})

describe('Ctrl+S', () => {
  test('writes what is owed now, and takes the press from the browser', () => {
    const event = press('s', { ctrl: true })

    expect(shortcuts.writeKey(event)).toBe(true)
    expect(writeNow).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  test('and not with Shift, which is not the chord', () => {
    expect(shortcuts.writeKey(press('S', { ctrl: true, shift: true }))).toBe(false)
    expect(writeNow).not.toHaveBeenCalled()
  })

  test('and nothing where something else already answered the press', () => {
    const event = press('s', { ctrl: true })
    event.preventDefault()

    expect(shortcuts.writeKey(event)).toBe(false)
    expect(writeNow).not.toHaveBeenCalled()
  })

  test('asks where a tab with no file goes, and writes nothing', async () => {
    front.active.note.path = null

    expect(shortcuts.writeKey(press('s', { ctrl: true }))).toBe(true)
    await vi.waitFor(() => expect(askPlace).toHaveBeenCalledWith('tab'))
    expect(writeNow).not.toHaveBeenCalled()
  })

  test('and the same of a web tab nobody has kept', async () => {
    front.active.note.path = null
    front.active.note.kind = 'web'

    shortcuts.writeKey(press('s', { ctrl: true }))
    await vi.waitFor(() => expect(askPlace).toHaveBeenCalledWith('tab'))
  })

  test('and no command of the registry has it', () => {
    expect(shortcuts.handle(press('s', { ctrl: true }), {} as never)).toBe(false)
  })
})
