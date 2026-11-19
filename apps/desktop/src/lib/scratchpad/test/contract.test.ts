import { describe, expect, test, vi } from 'vitest'

const right = vi.hoisted(() => ({ shows: null as string | null, closed: 0 }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    tabs: [],
    tabHere: () => null,
    outside: (path: string) => !path.startsWith('/space/'),
    showRight: (what: string) => {
      right.shows = what
    },
    closeRight: () => {
      right.shows = null
      right.closed++
    },
    closePanel: () => undefined,
    activate: () => undefined,
  },
}))
const api = await import('../src/api')
const { difference, joined } = await import('../src/words')
test('the module stands on its own the api loads with the pad, the card and the sync closed, and every call is there', () => {
  for (const one of [
    api.closeScratchpad,
    api.isScratchpad,
    api.loadScratchpadCard,
    api.pad,
    api.padTab,
    api.scratchFromDrawer,
    api.toggleScratchpad,
    api.wakeScratchpad,
  ]) {
    expect(typeof one).toBe('function')
  }
  expect(api.SCRATCHPAD).toBe('Scratchpad.md')
})
test('which file is the scratchpad a Scratchpad.md outside every space, and no note of that name inside one', () => {
  expect(api.isScratchpad('/app/Scratchpad.md')).toBe(true)
  expect(api.isScratchpad('/space/Scratchpad.md')).toBe(false)
  expect(api.isScratchpad('/app/Other.md')).toBe(false)
  expect(api.isScratchpad(null)).toBe(false)
  expect(api.padTab()).toBeNull()
})
describe('showing it on the right', () => {
  test('the toggle opens the side when it is hidden, and closing a hidden pad does nothing', () => {
    expect(api.shown.on).toBe(false)
    api.closeScratchpad()
    expect(right.closed).toBe(0)
    api.toggleScratchpad()
    expect(right.shows).toBe('scratchpad')
  })
  test('from the drawer it closes the side when shown and opens it when not', () => {
    api.shown.on = true
    api.scratchFromDrawer()
    expect(right.shows).toBeNull()
    api.shown.on = false
    api.scratchFromDrawer()
    expect(right.shows).toBe('scratchpad')
  })
  test('its sidebar part says whether it is shown and toggles it the way the drawer does', () => {
    api.shown.on = true
    expect(api.scratchpadPart.open?.()).toBe(true)
    api.scratchpadPart.toggle?.()
    expect(right.shows).toBeNull()
    api.shown.on = false
    expect(api.scratchpadPart.open?.()).toBe(false)
    api.scratchpadPart.toggle?.()
    expect(right.shows).toBe('scratchpad')
    expect(typeof api.scratchpadPart.toTab).toBe('function')
  })
})
describe('words added to the pad', () => {
  test('land after a blank line, end with one line break, and nothing is added for blanks', () => {
    expect(joined('first  \n', ' second ')).toBe('first\n\nsecond\n')
    expect(joined('', 'only')).toBe('only\n')
    expect(joined('kept', '   ')).toBe('kept')
  })
  test('a change is the one span between what stayed the same at both ends', () => {
    expect(difference('one two three', 'one 2 three')).toEqual({ from: 4, to: 7, insert: '2' })
    expect(difference('same', 'same')).toEqual({ from: 4, to: 4, insert: '' })
  })
})
