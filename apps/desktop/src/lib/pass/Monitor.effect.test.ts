import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('../ai/keys', () => ({
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

const { configurePass, pass } = await import('./store.svelte')
const { PassUi } = await import('./ui.svelte')
const Monitor = (await import('./Monitor.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined
const ids: Record<string, string> = {}

beforeAll(async () => {
  await pass.start()
  if (pass.state === 'new') await pass.setup('correct horse battery staple')
  const vault = pass.vaults[0]?.id ?? ''
  const login = (title: string, password: string) =>
    pass.create(vault, { ...blank('login'), title, password })
  ids.weak = (await login('Weak', 'abc123')).id
  ids.one = (await login('One', 'Vq8#mZ2!pL9@xR4$wT7&')).id
  ids.two = (await login('Two', 'Vq8#mZ2!pL9@xR4$wT7&')).id
  ids.strong = (await login('Strong', 'Kd3%nB8^qW1*eY6(uI0)')).id
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  target.remove()
})

function shownWith(ui: InstanceType<typeof PassUi>) {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(Monitor, { target, props: { ui }, intro: false })
  flushSync()
}

function card(flag: string): HTMLButtonElement {
  const found = target.querySelector<HTMLButtonElement>(`[data-flag="${flag}"]`)
  if (!found) throw new Error(`no ${flag} card`)
  return found
}

describe('Monitor', () => {
  test('counts weak and reused passwords, and none of the strong one', () => {
    shownWith(new PassUi(null))
    expect(card('weak').textContent).toContain('1')
    expect(card('reused').textContent).toContain('2')
    expect(card('excluded').disabled).toBe(true)
  })

  test('lists a card’s logins when it is pressed', () => {
    const ui = new PassUi(null)
    shownWith(ui)
    card('reused').click()
    flushSync()
    expect(ui.flag).toBe('reused')
    expect([...ui.flagged].sort()).toEqual([ids.one, ids.two].sort())
    card('weak').click()
    expect(ui.flag).toBe('weak')
    expect(ui.flagged).toEqual([ids.weak])
  })

  test('asks nobody about breaches until it is turned on', () => {
    const asked = vi.spyOn(globalThis, 'fetch')
    shownWith(new PassUi(null))
    expect(asked).not.toHaveBeenCalled()
    expect(target.textContent).toContain('Check')
    asked.mockRestore()
  })
})
