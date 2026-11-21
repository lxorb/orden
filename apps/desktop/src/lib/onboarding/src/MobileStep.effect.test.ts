import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const machine = vi.hoisted(() => ({ name: 'iPhone' }))
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  deviceName: () => machine.name,
}))
const { viewport } = await import('../../ui-kit/src/api')
const { setup } = await import('./setup-state.svelte')
const Setup = (await import('./Setup.svelte')).default
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.innerHTML = ''
  setup.showing = false
  viewport.device = 'desktop'
  localStorage.clear()
})
function opened(device: 'phone' | 'tablet' | 'desktop', name: string): HTMLElement {
  viewport.device = device
  machine.name = name
  localStorage.clear()
  setup.begin(false)
  const target = document.createElement('div')
  document.body.append(target)
  const made = mount(Setup, { target, intro: false })
  close = () => void unmount(made)
  flushSync()
  return target
}
const words = (target: HTMLElement) => target.textContent.replace(/\s+/g, ' ')
const button = (target: HTMLElement, label: string) =>
  [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === label)
describe('the setup on a mobile device', () => {
  test('is not offered on an iPhone, which is asked to go on on a MacBook', () => {
    const target = opened('phone', 'iPhone')
    expect(target.querySelector('h1')?.textContent).toBe('Onboarding is not available on mobile yet')
    expect(words(target)).toContain('Please continue on a MacBook')
    expect(words(target)).toContain("We know you guys want it on mobile. So we're already working on it :)")
    expect(words(target)).not.toContain('Log in or sign up')
    expect(button(target, 'Back')).toBeUndefined()
  })
  test('asks other phones and tablets to go on on a computer', () => {
    expect(words(opened('phone', 'Android phone'))).toContain('Please continue on a computer')
    close?.()
    expect(words(opened('tablet', 'Android browser'))).toContain('Please continue on a computer')
  })
  test('lets the app open once it is read, and never shows again', () => {
    const target = opened('phone', 'iPhone')
    button(target, 'Got it')?.click()
    flushSync()
    expect(setup.showing).toBe(false)
    expect(localStorage.getItem('orden:setup')).toBe('"done"')
  })
  test('runs as before on a computer', () => {
    const target = opened('desktop', 'Mac desktop')
    expect(target.querySelector('h1')?.textContent).toBe('Log in or sign up')
    expect(words(target)).not.toContain('not available on mobile')
  })
})
