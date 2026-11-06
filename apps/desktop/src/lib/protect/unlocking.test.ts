import { beforeEach, describe, expect, test, vi } from 'vitest'

const owner = vi.hoisted(() => ({ can: true, says: true }))

vi.mock('./device', () => ({
  deviceCan: () => Promise.resolve(owner.can),
  deviceName: () => 'Windows Hello',
  deviceSays: () => Promise.resolve(owner.can && owner.says),
}))

const { prompt } = await import('../prompt.svelte')
const { workspace } = await import('../workspace.svelte')
const { unlocks } = await import('./unlocked.svelte')
const { protect, unprotect } = await import('./unlocking')

const ROOT = '/space'
const NOTE = `${ROOT}/Plans.md`

function answering(id: string) {
  const timer = setInterval(() => {
    if (!prompt.open) return
    clearInterval(timer)
    prompt.pick(id)
  }, 1)
}

beforeEach(() => {
  Object.assign(owner, { can: true, says: true })
  workspace.protection.set(ROOT, NOTE, null)
  unlocks.lockAll()
})

describe('protecting with the device', () => {
  test('asks the system once and keeps the device as the way in', async () => {
    answering('device')
    await protect(ROOT, NOTE)
    expect(workspace.protection.own(ROOT, NOTE)?.way).toBe('device')
    expect(workspace.protection.locked(NOTE)).toBe(false)
    unlocks.lockAll()
    expect(workspace.protection.locked(NOTE)).toBe(true)
  })

  test('protects nothing when the system turns the reader away', async () => {
    owner.says = false
    answering('device')
    await protect(ROOT, NOTE)
    expect(workspace.protection.own(ROOT, NOTE)).toBeNull()
  })

  test('is what takes a lock away, the password forgotten', async () => {
    workspace.protection.set(ROOT, NOTE, 'password')
    await unprotect(ROOT, NOTE)
    expect(workspace.protection.own(ROOT, NOTE)).toBeNull()
  })

  test('cannot take a lock away when the system says no and there is no password', async () => {
    workspace.protection.set(ROOT, NOTE, 'device')
    owner.says = false
    await unprotect(ROOT, NOTE)
    expect(workspace.protection.own(ROOT, NOTE)?.way).toBe('device')
  })
})
