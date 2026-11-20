import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { settle } from '../../../../test/effects/settle'

const seen = vi.hoisted(() => ({
  unpacked: [] as unknown[],
  answered: 0,
  reloaded: 0,
}))
vi.mock('../../handoff/src/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  WEB: 'https://app.orden.so',
  LEGACY_WEBS: ['https://orden.so', 'https://nibeditor.com'],
  unpack: (handoff: unknown) => {
    seen.unpacked.push(handoff)
    return Promise.resolve()
  },
}))
vi.mock('../../workspace/src/api', () => ({
  firstVisiting: () =>
    Promise.resolve({
      firstVisit: {
        fresh: true,
        answered: () => {
          seen.answered++
        },
      },
    }),
}))
vi.stubGlobal('location', {
  origin: 'https://app.orden.so',
  reload: () => {
    seen.reloaded++
  },
})
const { takingOver } = await import('./taking-over.svelte')
const EMPTY = { kind: 'orden-handoff', databases: [], local: [] }
const HELD = { kind: 'orden-handoff', databases: [], local: [['orden:note', 'kept']] }
const popup = {
  closed: false,
  went: [] as string[],
  shut: 0,
  close() {
    this.shut++
  },
  location: { replace: (to: string) => popup.went.push(to) },
}
const opened: string[] = []
vi.spyOn(window, 'open').mockImplementation((to) => {
  opened.push(String(to))
  return popup as unknown as Window
})
const say = (origin: string, data: unknown, source: unknown = popup) =>
  window.dispatchEvent(Object.assign(new Event('message'), { origin, data, source }))
beforeEach(async () => {
  await settle()
  takingOver.state = 'idle'
  opened.length = 0
  popup.went.length = 0
  popup.shut = 0
  seen.unpacked.length = 0
  seen.answered = 0
  seen.reloaded = 0
})
afterAll(() => vi.unstubAllGlobals())
describe('taking notes over from the old addresses', () => {
  test('asks orden.so first and goes on to nibeditor.com in the same window when orden.so holds nothing', async () => {
    expect(takingOver.offered).toBe(true)
    takingOver.bring()
    expect(opened).toEqual(['https://orden.so/handoff'])
    say('https://orden.so', EMPTY)
    expect(popup.went).toEqual(['https://nibeditor.com/handoff'])
    expect(takingOver.state).toBe('asking')
    say('https://nibeditor.com', HELD)
    await settle()
    expect(seen.unpacked).toEqual([HELD])
    expect(seen.answered).toBe(1)
    expect(seen.reloaded).toBe(1)
  })
  test('takes from orden.so and never asks nibeditor.com when orden.so holds notes', async () => {
    takingOver.bring()
    say('https://orden.so', HELD)
    await settle()
    expect(popup.went).toEqual([])
    expect(seen.unpacked).toEqual([HELD])
  })
  test('says nothing is there and closes the window when both old addresses hold nothing', async () => {
    takingOver.bring()
    say('https://orden.so', EMPTY)
    say('https://nibeditor.com', EMPTY)
    await settle()
    expect(takingOver.state).toBe('nothing')
    expect(popup.shut).toBe(1)
    expect(seen.unpacked).toEqual([])
  })
  test('hears only the old address it is asking, from the window it opened', async () => {
    takingOver.bring()
    say('https://elsewhere.example', HELD)
    say('https://nibeditor.com', HELD)
    say('https://orden.so', HELD, window)
    expect(takingOver.state).toBe('asking')
    say('https://orden.so', EMPTY)
    say('https://orden.so', HELD)
    say('https://app.orden.so', HELD)
    await settle()
    expect(seen.unpacked).toEqual([])
    expect(takingOver.state).toBe('asking')
    say('https://nibeditor.com', EMPTY)
    expect(takingOver.state).toBe('nothing')
  })
})
