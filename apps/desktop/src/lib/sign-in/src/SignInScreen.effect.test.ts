import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { elapse } from '../../../../test/effects/settle'

const { account } = await import('../../accounts/src/api')
const SignInScreen = (await import('./SignInScreen.svelte')).default
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.innerHTML = ''
  account.step = 'email'
  account.email = ''
  localStorage.clear()
})
function opened(given: { alone: boolean; onsignedin: () => void; onalone?: () => void }): HTMLElement {
  const props = { name: 'Orden Track', ...given }
  const target = document.createElement('div')
  document.body.append(target)
  const made = mount(SignInScreen, { target, props })
  close = () => void unmount(made)
  flushSync()
  return target
}
const button = (target: HTMLElement, label: string) =>
  [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === label)
describe('the first screen of a phone app (#2286)', () => {
  test('names its app, asks for an email under Log in or sign up, and waits for one before it goes on', () => {
    const target = opened({ alone: false, onsignedin: () => undefined })
    expect(target.querySelector('h1')?.textContent).toBe('Orden Track')
    expect(target.textContent).toContain('Log in or sign up')
    expect(target.querySelector('input[type="email"]')).not.toBeNull()
    expect(button(target, 'Continue')?.disabled).toBe(true)
    account.email = 'ada@example.com'
    flushSync()
    expect(button(target, 'Continue')?.disabled).toBe(false)
  })
  test('offers going on without an account only to the app that says it works alone', () => {
    let alone = 0
    const notes = opened({ alone: true, onsignedin: () => undefined, onalone: () => (alone += 1) })
    button(notes, 'Use without an account')?.click()
    expect(alone).toBe(1)
    close?.()
    close = undefined
    const todo = opened({ alone: false, onsignedin: () => undefined, onalone: () => (alone += 1) })
    expect(button(todo, 'Use without an account')).toBeUndefined()
  })
  test('tells the app once the code is taken, and not before', async () => {
    vi.useFakeTimers()
    const code = account.code.bind(account)
    let signed = 0
    try {
      account.email = 'ada@example.com'
      account.step = 'code'
      account.code = () => Promise.resolve(true)
      const target = opened({ alone: false, onsignedin: () => (signed += 1) })
      expect(target.querySelectorAll('.digits input')).toHaveLength(1)
      expect(target.querySelectorAll('.digits .box')).toHaveLength(6)
      const first = target.querySelector<HTMLInputElement>('.digits input')!
      first.value = '123456'
      first.dispatchEvent(new Event('input', { bubbles: true }))
      flushSync()
      await elapse(0)
      expect(signed).toBe(0)
      await elapse(2000)
      expect(signed).toBe(1)
    } finally {
      account.code = code
      vi.useRealTimers()
    }
  })
  test('goes back from the code to the email', () => {
    account.email = 'typo@exmaple.com'
    account.step = 'code'
    const target = opened({ alone: false, onsignedin: () => undefined })
    button(target, 'Back')?.click()
    flushSync()
    expect(account.step).toBe('email')
    expect(target.querySelector('input[type="email"]')).not.toBeNull()
  })
})
