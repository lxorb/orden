import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const { workspace } = await import('../../../workspace.svelte')
const { unlocks } = await import('../../../protect/src/unlocked.svelte')
const lockedAt = (path: string) => workspace.protection.locked(path)
const { hashPassword } = await import('../../../protect/src/password')
const LockScreen = (await import('./LockScreen.svelte')).default

const ROOT = '/space'
const NOTE = `${ROOT}/Inside/Plans.md`

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined

beforeEach(async () => {
  workspace.protection.setPassword(await hashPassword('tulip ladder'))
  workspace.protection.set(ROOT, `${ROOT}/Inside`, 'password')
  unlocks.lockAll()
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(LockScreen, { target, props: { path: NOTE }, intro: false })
  flushSync()
})

afterEach(() => {
  if (shown) void unmount(shown)
  target.remove()
  workspace.protection.set(ROOT, `${ROOT}/Inside`, null)
  workspace.protection.setPassword(null)
})

async function typeAndUnlock(password: string) {
  const field = target.querySelector('input')
  if (!field) throw new Error('no field')
  field.value = password
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
  await new Promise((done) => setTimeout(done, 1500))
  flushSync()
}

describe('the lock screen', () => {
  test('shows the name and says it is not encryption, never the words', () => {
    expect(lockedAt(NOTE)).toBe(true)
    expect(target.textContent).toContain('Plans.md')
    expect(target.textContent).toContain('not encrypted')
  })

  test('stays shut for a wrong password, and says so', async () => {
    await typeAndUnlock('tulip')
    expect(lockedAt(NOTE)).toBe(true)
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Wrong password')
  })

  test('opens for the password, and everything under the same lock with it', async () => {
    await typeAndUnlock('tulip ladder')
    expect(lockedAt(NOTE)).toBe(false)
    expect(lockedAt(`${ROOT}/Inside/Other.md`)).toBe(false)
  })
})
