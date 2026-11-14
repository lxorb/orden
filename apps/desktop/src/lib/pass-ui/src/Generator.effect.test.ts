import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

const { pass } = await import('../../pass-sync/src/store.svelte')
const { PassUi } = await import('../../pass-sync/src/ui.svelte')
const Generator = (await import('./Generator.svelte')).default

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined
let ui: InstanceType<typeof PassUi>
const used = vi.fn<(password: string) => void>()

beforeEach(() => {
  localStorage.clear()
  used.mockClear()
  ui = new PassUi(null)
  ui.sheet = { kind: 'generator', use: used }
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(Generator, { target, props: { ui }, intro: false })
  flushSync()
})

afterEach(() => {
  if (shown) void unmount(shown)
  target.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const result = () => document.querySelector('.generated')?.textContent ?? ''

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (one) => one.textContent.trim() === name || one.getAttribute('aria-label') === name,
  )
  if (!found) throw new Error(`no ${name}`)
  return found
}

describe('the generator', () => {
  test('makes a password as long as asked, of the kinds asked', () => {
    expect(result()).toHaveLength(20)
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')
    if (!slider) throw new Error('no slider')
    slider.value = '8'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(result()).toHaveLength(8)

    button('Symbols').click()
    button('Numbers').click()
    button('Capital letters').click()
    flushSync()
    expect(result()).toMatch(/^[a-z]{8}$/)
  })

  test('makes words in the memorable mode', () => {
    button('Memorable').click()
    flushSync()
    expect(result().match(/(?:^|-)[A-Z]/g)).toHaveLength(5)
  })

  test('hands the password to Use and closes', () => {
    const made = result()
    button('Use').click()
    flushSync()
    expect(used).toHaveBeenCalledWith(made)
    expect(ui.sheet).toBeNull()
  })

  test('copies through Pass', () => {
    const copy = vi.spyOn(pass, 'copy').mockResolvedValue()
    const made = result()
    button('Copy').click()
    expect(copy).toHaveBeenCalledWith(made)
  })

  test('makes another on Regenerate', () => {
    const first = result()
    button('Regenerate').click()
    flushSync()
    expect(result()).not.toBe(first)
  })
})
