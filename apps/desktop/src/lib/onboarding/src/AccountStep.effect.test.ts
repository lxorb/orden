import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

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
