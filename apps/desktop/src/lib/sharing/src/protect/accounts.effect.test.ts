import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { settle } from '../../../../../test/effects/settle'

const owner = vi.hoisted(() => ({ can: false }))
vi.mock('../../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(owner.can),
  deviceName: () => 'Windows Hello',
  deviceSays: () => Promise.resolve(true),
}))
const { account } = await import('../../../accounts/src/api')
const { busy } = await import('../../../ui-kit/src/busy.svelte')
const { workspace } = await import('../../../workspace/src/api')
const { unlocks } = await import('../../../protect/src/unlocked.svelte')
const { hashPassword } = await import('../../../protect/src/password')
const { protect, unlockAt } = await import('./unlocking')
const PromptSheet = (await import('../../../surfaces/src/PromptSheet.svelte')).default
const LockScreen = (await import('./LockScreen.svelte')).default
const protection = workspace.protection
let shown: ReturnType<typeof mount>[] = []
let made: { root: string; path: string; as: string }[] = []
const as = (id: string) => {
  account.token = `token-${id}`
  account.user = { id, email: `${id}@example.org`, name: id }
}
function locked(id: string, root: string, path: string) {
  as(id)
  protection.set(root, path, 'password')
  made.push({ root, path, as: id })
}
async function choose(id: string, words: string) {
  as(id)
  protection.setPassword(await hashPassword(words))
}
function place(): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  return target
}
function lockScreen(path: string) {
  shown.push(mount(LockScreen, { target: place(), props: { path }, intro: false }))
  flushSync()
}
beforeEach(() => {
  owner.can = false
  busy.clear()
  unlocks.lockAll()
  shown.push(mount(PromptSheet, { target: place(), intro: false }))
  flushSync()
})
afterEach(() => {
  for (const one of shown) void unmount(one)
  shown = []
  document.body.innerHTML = ''
  for (const one of made) {
    as(one.as)
    protection.set(one.root, one.path, null)
  }
  made = []
  for (const id of ['ada', 'bo']) {
    as(id)
    protection.setPassword(null)
  }
  account.user = null
  account.token = null
})
describe('another account signed in on this device', () => {
  test('is asked to choose a password of its own, not handed the last one’s', async () => {
    await choose('ada', 'alpha horn')
    as('bo')
    void protect('/bo-space', '/bo-space/Plans.md')
    await settle()
    expect(document.body.textContent).toContain('Choose a password')
  })
  test('cannot open the last account’s lock with its own password, while that account’s password does', async () => {
    locked('ada', '/ada-space', '/ada-space/Diary.md')
    await choose('ada', 'alpha horn')
    await choose('bo', 'bravo drum')
    unlocks.lockAll()
    expect(await unlockAt('/ada-space/Diary.md', 'bravo drum')).toBe(false)
    expect(protection.locked('/ada-space/Diary.md')).toBe(true)
    expect(await unlockAt('/ada-space/Diary.md', 'alpha horn')).toBe(true)
    expect(protection.locked('/ada-space/Diary.md')).toBe(false)
  })
  test('is offered no password lock in the last account’s space, and told why', async () => {
    locked('ada', '/ada-home', '/ada-home/Diary.md')
    await choose('bo', 'bravo drum')
    void protect('/ada-home', '/ada-home/Plans.md')
    await settle()
    expect(protection.own('/ada-home', '/ada-home/Plans.md')).toBeNull()
    expect(document.body.textContent).not.toContain('Choose a password')
    expect(busy.trouble).toContain('another account')
  })
  test('locks the last account’s space with the device instead, where it can', async () => {
    owner.can = true
    locked('ada', '/ada-room', '/ada-room/Diary.md')
    as('bo')
    made.push({ root: '/ada-room', path: '/ada-room/Plans.md', as: 'bo' })
    void protect('/ada-room', '/ada-room/Plans.md')
    await settle()
    expect(protection.own('/ada-room', '/ada-room/Plans.md')?.way).toBe('device')
  })
  test('sees no password field on a lock its own password cannot open', async () => {
    locked('ada', '/ada-desk', '/ada-desk/Diary.md')
    await choose('bo', 'bravo drum')
    lockScreen('/ada-desk/Diary.md')
    expect(document.querySelector('input[type=password]')).toBeNull()
  })
  test('sees the password field where the password of the space’s own account is here', async () => {
    locked('ada', '/ada-den', '/ada-den/Diary.md')
    await choose('ada', 'alpha horn')
    as('bo')
    lockScreen('/ada-den/Diary.md')
    expect(document.querySelector('input[type=password]')).not.toBeNull()
  })
})
