import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  localStorage.setItem(
    'orden:setup',
    JSON.stringify({ step: 'account', trail: ['welcome', 'account'], answers: {}, signedIn: false }),
  )
})
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.getAnimations = () => []
const Setup = (await import('../../src/lib/onboarding/src/Setup.svelte')).default
const { account } = await import('../../src/lib/accounts/src/api')
let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
})
const drawn = () => [...document.querySelectorAll<HTMLElement>('.setup .stage, .setup h1, .setup .rise')]
test('focusing, typing in and leaving the email field never draws the sign-in step again, so its entrance plays once (#2406)', async () => {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(Setup, { target, intro: false })
  flushSync()
  await new Promise((done) => setTimeout(done, 0))
  flushSync()
  const field = document.querySelector<HTMLInputElement>('.setup input[aria-label="Email address"]')
  expect(field).not.toBeNull()
  const before = drawn()
  expect(before.length).toBeGreaterThanOrEqual(3)
  field?.focus()
  field?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  field?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  flushSync()
  account.email = 'a@b.co'
  flushSync()
  window.dispatchEvent(new FocusEvent('blur'))
  window.dispatchEvent(new FocusEvent('focus'))
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('resize'))
  field?.blur()
  flushSync()
  await new Promise((done) => setTimeout(done, 0))
  flushSync()
  const after = drawn()
  expect(after).toHaveLength(before.length)
  after.forEach((one, at) => expect(one).toBe(before[at]))
  expect(document.querySelector('.setup')?.getAttribute('data-step')).toBe('account')
})
