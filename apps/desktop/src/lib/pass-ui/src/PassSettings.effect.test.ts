import 'fake-indexeddb/auto'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('../../ai/keys', () => ({
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

const delivered = vi.hoisted(() => [] as string[])
vi.mock('../../files-out/src/save', () => ({
  deliver: (name: string) => {
    delivered.push(name)
    return Promise.resolve(name)
  },
}))

const { configurePass, pass } = await import('../../pass-sync/src/store.svelte')
const { PassUi } = await import('../../pass-sync/src/ui.svelte')
const PassSettings = (await import('./PassSettings.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
const PASSWORD = 'correct horse battery staple'
configurePass({ kdf: FAST, pinKdf: FAST })

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined

beforeAll(async () => {
  await pass.start()
  if (pass.state === 'new') await pass.setup(PASSWORD)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  target.remove()
})

function shownOn(tab: 'general' | 'export') {
  const ui = new PassUi(null)
  ui.show({ settingsTab: tab })
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(PassSettings, { target, props: { ui }, intro: false })
  flushSync()
}

async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !ready(); tries++) {
    await new Promise((done) => setTimeout(done, 20))
    flushSync()
  }
}

function typed(field: HTMLInputElement | undefined, value: string) {
  if (!field) throw new Error('no field')
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

describe('Pass settings', () => {
  test('a row is its switch', () => {
    shownOn('general')
    const row = [...target.querySelectorAll<HTMLButtonElement>('[role=switch]')].find(
      (one) => one.textContent.trim() === 'Sign in automatically',
    )
    expect(row?.getAttribute('aria-checked')).toBe('false')
    row?.click()
    flushSync()
    expect(pass.settings.autoLogin).toBe(true)
    expect(row?.getAttribute('aria-checked')).toBe('true')
    row?.click()
    expect(pass.settings.autoLogin).toBe(false)
  })

  test('export asks for the Pass password, and says when it is wrong', async () => {
    shownOn('export')
    const csv = [...target.querySelectorAll<HTMLButtonElement>('[role=radio]')].find(
      (one) => one.textContent.trim() === 'CSV',
    )
    csv?.click()
    flushSync()
    const field = () => target.querySelector<HTMLInputElement>('input[type=password]') ?? undefined
    typed(field(), 'not it')
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await until(() => target.querySelector('[role=alert]') !== null)
    expect(target.querySelector('[role=alert]')?.textContent).toContain('Wrong password')
    expect(delivered).toEqual([])

    typed(field(), PASSWORD)
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await until(() => delivered.length > 0)
    expect(delivered[0]).toMatch(/^orden-pass-/)
  })
})
