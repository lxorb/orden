import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const clocks = vi.hoisted(() => [] as { every: number | (() => number); run: () => void }[])
vi.mock('../../panes/src/api', async (actual) => ({
  ...(await actual<typeof import('../../panes/src/api')>()),
  whileShown: (every: number | (() => number), run: () => void) => void clocks.push({ every, run }),
}))
const STARTED = Date.UTC(2026, 10, 21, 9, 0)
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({
  chat: {
    text: '',
    chips: [],
    queue: [],
    turns: [],
    heads: [],
    busy: false,
    canSteer: false,
    changing: true,
    thread: null,
    model: null,
    root: null,
    trouble: null,
    provider: { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' },
    head: {
      id: 'c1',
      usage: {},
      goal: {
        state: 'pursuing',
        condition: 'All herons counted',
        started: Date.UTC(2026, 10, 21, 9, 0),
        turns: 2,
        tokens: 900,
        budget: { turns: 10 },
      },
    },
    taken: () => undefined,
    submit: () => undefined,
    focus: () => undefined,
  },
}))
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
const { USAGE_EVERY, ai, usage } = await import('../../ai-providers/src/api')
const Composer = (await import('./Composer.svelte')).default
const AiPane = (await import('./AiPane.svelte')).default
const shown: { close: () => void }[] = []
function draw(component: Parameters<typeof mount>[0]) {
  const target = document.createElement('div')
  document.body.append(target)
  const drawn = mount(component, { target, props: {} })
  flushSync()
  shown.push({ close: () => void unmount(drawn).then(() => target.remove()) })
  return target
}
afterEach(() => {
  for (const one of shown.splice(0)) one.close()
  clocks.length = 0
  vi.restoreAllMocks()
})
test('the goal clock of the side chat ticks through whileShown, so a tab kept behind stops it (#2412)', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(STARTED + 60_000)
  const interval = vi.spyOn(globalThis, 'setInterval')
  const target = draw(Composer as never)
  expect(clocks.map((one) => one.every)).toEqual([30_000])
  expect(interval).not.toHaveBeenCalledWith(expect.anything(), 30_000)
  const before = target.querySelector('.meta')?.textContent ?? ''
  now.mockReturnValue(STARTED + 7 * 60_000)
  clocks[0]?.run()
  flushSync()
  expect(target.querySelector('.meta')?.textContent).not.toBe(before)
})
test('the AI pane looks at usage through whileShown, never by an interval of its own (#2412)', () => {
  const interval = vi.spyOn(globalThis, 'setInterval')
  const looked = vi.spyOn(usage, 'look').mockResolvedValue()
  draw(AiPane as never)
  expect(clocks.map((one) => one.every)).toEqual([USAGE_EVERY])
  expect(interval).not.toHaveBeenCalledWith(expect.anything(), USAGE_EVERY)
  clocks[0]?.run()
  expect(looked.mock.calls.map(([one]) => one.id)).toEqual(ai.accounts.map((one) => one.id))
})
