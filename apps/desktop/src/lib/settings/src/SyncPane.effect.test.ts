import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  rolled: [] as { space: string; at: number; preview: boolean }[],
  space: 'space-a',
  engine: null as object | null,
  held: [] as { id: string; name: string; theirs: { at: number } }[],
  clashes: [] as { path: string; at: number }[],
}))
vi.mock('../../accounts/src/api', async (original) => ({
  ...(await original<typeof import('../../accounts/src/api')>()),
  account: {
    accountToken: 'token',
    forgetWithSession: () => undefined,
    holdsNoAccount: () => undefined,
  },
  api: {
    rollback: (_token: string, space: string, at: number, _path = '', preview = false) => {
      world.rolled.push({ space, at, preview })
      return Promise.resolve({ notes: 3, left: 0, paths: [], more: false, partial: false })
    },
  },
}))
vi.mock('../../sync-store/src/api', () => ({
  sync: { remoteIdFor: () => world.space, nudge: () => undefined },
}))
vi.mock('../../sync-client/src/api', () => ({
  asking: {
    get engine() {
      return world.engine
    },
    get held() {
      return world.held
    },
  },
  scan: () => undefined,
}))
vi.mock('../../foreign/src/api', () => ({
  syncedCopies: () => ({ count: 0, remove: () => Promise.resolve() }),
}))
vi.mock('../../sync-mirror/src/api', async (original) => ({
  ...(await original<typeof import('../../sync-mirror/src/api')>()),
  record: {
    passes: [],
    get clashes() {
      return world.clashes
    },
    settle: () => Promise.resolve(),
  },
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: { activeSpace: { root: '/space' }, spaces: [] },
}))
const { modes, KEEP_MONTH, KEEP_YEAR } = await import('../../modes/src/api')
const SyncPane = (await import('./SyncPane.svelte')).default
const settled = () => new Promise((resolve) => setTimeout(resolve))
const DAY = 24 * 60 * 60 * 1000
let target: HTMLElement
let close: (() => void) | undefined
beforeEach(() => {
  world.rolled = []
  world.space = 'space-a'
  world.engine = null
  world.held = []
  world.clashes = []
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  target.remove()
})
function button(label: string): HTMLButtonElement | undefined {
  return [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === label)
}
describe('going back to how a space was', () => {
  test('never goes back further than the moment the picker shows', async () => {
    modes.setKeepVersions(KEEP_YEAR)
    const made = mount(SyncPane, { target })
    close = () => void unmount(made)
    flushSync()
    target.querySelector<HTMLButtonElement>('[aria-label="This space, as it was"]')?.click()
    flushSync()
    const far = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (one) => one.textContent.trim() === '180 days ago',
    )
    if (!far) throw new Error('no 180 days ago')
    far.click()
    flushSync()
    button('What would change?')?.click()
    await settled()
    flushSync()
    const looked = world.rolled.at(-1)?.at ?? 0
    modes.setKeepVersions(KEEP_MONTH)
    flushSync()
    button('Go back')?.click()
    await settled()
    expect(Date.now() - looked).toBeGreaterThan(170 * DAY)
    const went = world.rolled.filter((one) => !one.preview)
    expect(went.every((one) => Date.now() - one.at <= KEEP_MONTH * DAY + 60_000)).toBe(true)
  })
})
describe('a note waiting for you', () => {
  test("is named without Orden's own ending, and with its folder where the sync gave its path", () => {
    world.clashes = [{ path: '/s/Plans/Notes/Board.canvas', at: 1 }]
    let made = mount(SyncPane, { target })
    flushSync()
    expect(target.querySelector('.clash .name')?.textContent).toBe('Notes/Board')
    void unmount(made)
    world.engine = { on: () => () => undefined, store: { read: () => Promise.resolve([[], []]) } }
    world.held = [{ id: 'n1', name: 'Plan.md', theirs: { at: 1 } }]
    made = mount(SyncPane, { target })
    close = () => void unmount(made)
    flushSync()
    expect(target.querySelector('.held .name')?.textContent).toBe('Plan')
  })
})
