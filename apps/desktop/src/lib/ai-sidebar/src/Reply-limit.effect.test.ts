import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  retried: [] as unknown[],
  shown: [] as string[],
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({
  chat: {
    unfolded: false,
    root: '/n/Work',
    head: { id: 'c1' },
    provider: { id: 'plan', kind: 'claude-code', name: 'Claude Code', model: 'default' },
    models: {},
    resets: { c1: { until: Date.UTC(2026, 10, 22, 19), waiting: false } },
    retryWith: (provider: string) => void world.retried.push(provider),
    waitForReset: () => undefined,
  },
}))
vi.mock('@orden/contracts', async (actual) => ({
  ...(await actual<typeof import('@orden/contracts')>()),
  settingsWindow: () => ({ show: (pane: string) => void world.shown.push(pane) }),
}))
const { ai } = await import('../../ai-providers/src/api')
const Reply = (await import('./Reply.svelte')).default
const PLAN = { id: 'plan', kind: 'claude-code', name: 'Claude Code', model: 'default' }
const KEY = { id: 'key', kind: 'anthropic', name: 'Claude', model: 'claude-sonnet-4-5' }
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  world.retried.length = 0
  world.shown.length = 0
  vi.restoreAllMocks()
})
function limited(providers: unknown[]) {
  vi.spyOn(ai, 'providers', 'get').mockReturnValue(providers as never)
  const turn = {
    id: 't1',
    role: 'model',
    parts: [{ kind: 'notice', code: 'error', text: 'Your Claude plan is at its limit until Nov 22, 2026, 8:00 PM.' }],
  }
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Reply, { target, props: { turn: turn as never, sources: [], last: true, live: false } })
  flushSync()
  close = () => void unmount(shown).then(() => target.remove())
  return [...target.querySelectorAll<HTMLButtonElement>('.notice .link')]
}
test('a chat at its plan limit offers every other provider, and asks again with the one picked (#2414)', () => {
  const links = limited([PLAN, KEY])
  const ask = links.find((one) => one.textContent.trim() === 'Ask Claude')
  expect(links.map((one) => one.textContent.trim())).not.toContain('Ask Claude Code')
  ask?.click()
  expect(world.retried).toEqual(['key'])
})
test('a chat at its plan limit with no other provider offers to add one (#2414)', () => {
  const links = limited([PLAN])
  const add = links.find((one) => one.textContent.trim() === 'Add a provider')
  add?.click()
  expect(world.shown).toEqual(['ai'])
})
