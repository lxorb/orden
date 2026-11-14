import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const owner = vi.hoisted(() => ({ can: true, says: true, asked: 0 }))

vi.mock('../../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(owner.can),
  deviceName: () => 'Touch ID',
  deviceSays: () => {
    owner.asked++
    return Promise.resolve(owner.can && owner.says)
  },
}))

const { workspace } = await import('../../../workspace.svelte')
const { unlocks } = await import('../../../protect/src/unlocked.svelte')
const LockScreen = (await import('./LockScreen.svelte')).default

const ROOT = '/space'
const NOTE = `${ROOT}/Diary.md`

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined

async function show() {
  shown = mount(LockScreen, { target, props: { path: NOTE }, intro: false })
  await Promise.resolve()
  await Promise.resolve()
  flushSync()
}

function deviceButton(): HTMLButtonElement | undefined {
  return [...target.querySelectorAll('button')].find((one) => one.textContent.includes('Touch ID'))
}

beforeEach(() => {
  Object.assign(owner, { can: true, says: true, asked: 0 })
  workspace.protection.set(ROOT, NOTE, 'device')
  unlocks.lockAll()
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (shown) void unmount(shown)
  target.remove()
  workspace.protection.set(ROOT, NOTE, null)
})

describe('a lock the device opens', () => {
  test('opens when the system says it is the owner', async () => {
    await show()
    deviceButton()?.click()
    await new Promise((done) => setTimeout(done, 0))
    expect(owner.asked).toBe(1)
    expect(workspace.protection.locked(NOTE)).toBe(false)
  })

  test('stays shut when the system says no', async () => {
    owner.says = false
    await show()
    deviceButton()?.click()
    await new Promise((done) => setTimeout(done, 0))
    expect(workspace.protection.locked(NOTE)).toBe(true)
  })

  test('on a device that cannot ask, says where the file still is', async () => {
    owner.can = false
    await show()
    expect(deviceButton()).toBeUndefined()
    expect(target.textContent.replace(/\s+/g, ' ')).toContain(
      'another device can remove the protection',
    )
  })
})
