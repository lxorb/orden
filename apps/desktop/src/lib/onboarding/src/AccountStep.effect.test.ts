import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const { account } = await import('../../accounts/src/api')
const { setup } = await import('./setup-state.svelte')
const AccountStep = (await import('./AccountStep.svelte')).default
const AppearanceStep = (await import('./AppearanceStep.svelte')).default

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  document.body.innerHTML = ''
  account.step = 'email'
  setup.showing = false
  localStorage.clear()
})

describe('the log in during setup', () => {
  test('goes back from the code to the email, to put a mistyped address right', () => {
    setup.begin(false)
    account.email = 'typo@exmaple.com'
    account.step = 'code'
    const target = document.createElement('div')
    document.body.append(target)
    const made = mount(AccountStep, { target })
    close = () => void unmount(made)
    flushSync()

    const back = [...target.querySelectorAll('button')].find(
      (one) => one.textContent.trim() === 'Back',
    )
    expect(back).toBeDefined()
    back?.click()
    flushSync()

    expect(account.step).toBe('email')
    expect(target.querySelector('input[type="email"]')).not.toBeNull()
    expect(setup.step).toBe('account')
  })
})

describe('a code taken in', () => {
  function entering(answer: () => Promise<boolean>) {
    setup.begin(false)
    account.email = 'me@example.com'
    account.step = 'code'
    account.code = answer
    const target = document.createElement('div')
    document.body.append(target)
    const made = mount(AccountStep, { target })
    close = () => void unmount(made)
    flushSync()
    const first = target.querySelector<HTMLInputElement>('.digits input')!
    first.value = '123456'
    first.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    return target
  }

  test('moves setup on only while its step is still shown', async () => {
    vi.useFakeTimers()
    const code = account.code.bind(account)
    try {
      entering(() => Promise.resolve(true))
      await vi.advanceTimersByTimeAsync(0)
      const at = setup.step
      close?.()
      close = undefined
      await vi.advanceTimersByTimeAsync(2000)
      expect(setup.step).toBe(at)
    } finally {
      account.code = code
      vi.useRealTimers()
    }
  })

  test('that cannot be checked clears the boxes to type it again', async () => {
    const code = account.code.bind(account)
    try {
      const target = entering(() => Promise.reject(new Error('offline')))
      await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector<HTMLInputElement>('.digits input')?.value).toBe('')
      })
    } finally {
      account.code = code
    }
  })
})

describe('a screen on its way out', () => {
  test('moves nothing on a second Enter, so the next question is not skipped', () => {
    setup.begin(true)
    expect(setup.step).toBe('appearance')
    const target = document.createElement('div')
    document.body.append(target)
    const made = mount(AppearanceStep, { target })
    close = () => void unmount(made)
    flushSync()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(setup.step).toBe('heard')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(setup.step).toBe('heard')
  })
})

describe('skipping the appearance question', () => {
  test('keeps a look the account brought while the question was shown', async () => {
    const { theme } = await import('../../theme/src/api')
    theme.setScheme('system')
    setup.begin(true)
    const target = document.createElement('div')
    document.body.append(target)
    const made = mount(AppearanceStep, { target })
    close = () => void unmount(made)
    flushSync()

    theme.setScheme('dark')
    const skip = [...target.querySelectorAll('button')].find(
      (one) => one.textContent.trim() === 'Skip',
    )
    skip?.click()
    flushSync()

    expect(theme.scheme).toBe('dark')
    expect(setup.step).toBe('heard')
  })
})

describe('skipping after picking a look', () => {
  test('puts back the look from before the question', async () => {
    const { theme } = await import('../../theme/src/api')
    theme.setScheme('system')
    setup.begin(true)
    const target = document.createElement('div')
    document.body.append(target)
    const made = mount(AppearanceStep, { target })
    close = () => void unmount(made)
    flushSync()

    const buttons = [...target.querySelectorAll('button')]
    buttons.find((one) => one.textContent.trim() === 'Dark')?.click()
    flushSync()
    expect(theme.scheme).toBe('dark')
    buttons.find((one) => one.textContent.trim() === 'Skip')?.click()
    flushSync()

    expect(theme.scheme).toBe('system')
  })
})
