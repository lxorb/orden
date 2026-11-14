import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const owner = vi.hoisted(() => ({ says: 'yes' }))

vi.mock('../../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(true),
  deviceName: () => 'Windows Hello',
  deviceSays: () =>
    owner.says === 'fails'
      ? Promise.reject(new Error('Windows Hello is not set up for this account'))
      : Promise.resolve(owner.says === 'yes'),
}))

const { busy } = await import('../../../ui-kit/src/busy.svelte')
const { workspace } = await import('../../../workspace.svelte')
const { protect } = await import('./unlocking')
const PromptSheet = (await import('../../../PromptSheet.svelte')).default

const ROOT = '/space'
const NOTE = `${ROOT}/Plans.md`

let shown: ReturnType<typeof mount> | undefined

beforeEach(() => {
  owner.says = 'yes'
  busy.clear()
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(PromptSheet, { target, intro: false })
})

afterEach(() => {
  if (shown) void unmount(shown)
  document.body.innerHTML = ''
  workspace.protection.set(ROOT, NOTE, null)
  workspace.protection.setPassword(null)
})

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((done) => setTimeout(done, 10))
    flushSync()
  }
}

function press(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === label,
  )
  if (!button) throw new Error(`no ${label} in ${document.body.textContent}`)
  button.click()
}

function type(into: number, words: string) {
  const field = document.querySelectorAll<HTMLInputElement>('input[type=password]')[into]
  if (!field) throw new Error(`no password field ${into}`)
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

async function chosen(label: string) {
  void protect(ROOT, NOTE)
  await settle()
  press(label)
  await settle()
}

describe('protecting from the menu', () => {
  test('with a password asks for one, and protects with it', async () => {
    await chosen('Password')
    expect(document.body.textContent).toContain('Choose a password')
    type(0, 'tulip ladder')
    type(1, 'tulip ladder')
    flushSync()
    press('Protect')
    await settle()
    await new Promise((done) => setTimeout(done, 1500))
    expect(workspace.protection.own(ROOT, NOTE)?.way).toBe('password')
  })

  test('with the device protects once it says yes', async () => {
    await chosen('Windows Hello')
    expect(workspace.protection.own(ROOT, NOTE)?.way).toBe('device')
    expect(busy.trouble).toBeNull()
  })

  test('with the device says so when the device says no', async () => {
    owner.says = 'no'
    await chosen('Windows Hello')
    expect(workspace.protection.own(ROOT, NOTE)).toBeNull()
    expect(busy.trouble).toContain('did not confirm')
  })

  test('with a device that cannot ask says why, and offers the password', async () => {
    owner.says = 'fails'
    await chosen('Windows Hello')
    expect(busy.trouble).toContain('not set up for this account')
    expect(document.body.textContent).toContain('Choose a password')
  })
})
