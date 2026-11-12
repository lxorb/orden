import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const asked = vi.hoisted(() => ({ answer: true, details: [] as string[] }))
vi.mock('../prompt.svelte', () => ({
  prompt: {
    confirm: (options: { detail?: string }) => {
      asked.details.push(options.detail ?? '')
      return Promise.resolve(asked.answer)
    },
  },
}))

const { workspace } = await import('../workspace.svelte')
const { hiddenKinds } = await import('../settings.svelte')
const { unlocks } = await import('./unlocked.svelte')
const { protectEntries } = await import('./entries')
const { NO_PROTECTION_WORD, PROTECTION_WORD, protectionOn } = await import('./gate')
const { turnProtection } = await import('./protection-setting')
const { generalPane } = await import('../settings/general-pane')

const ROOT = '/space'
const DIARY = `${ROOT}/Diary.md`
const PLANS = `${ROOT}/Plans.md`
const LOCK = { root: ROOT, key: 'Diary.md', way: 'password' as const }

const ids = (path: string) => protectEntries(path).map((one) => one.id)

const protectionFields = () =>
  generalPane()
    .groups.filter((group) => group.title === 'Protection')
    .flatMap((group) => group.fields.map((one) => one.key))

beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'Space', root: ROOT }]
  hiddenKinds.hidden = []
  asked.answer = true
  asked.details = []
})

afterEach(() => {
  unlocks.lockAll()
  workspace.protection.set(ROOT, DIARY, null)
})

describe('Use protection (#2013)', () => {
  test('starts off for an account with nothing protected, with no Protect anywhere', () => {
    expect(protectionOn()).toBe(false)
    expect(ids(PLANS)).toEqual([])
    expect(ids(ROOT)).toEqual([])
    expect(protectionFields()).toEqual(['general.protection'])
  })

  test('starts on for an account that already protects something', () => {
    workspace.protection.set(ROOT, DIARY, 'password')
    expect(protectionOn()).toBe(true)
    expect(ids(DIARY)).toEqual(['unprotect'])
    expect(ids(PLANS)).toEqual(['protect'])
    expect(protectionFields()).toEqual(['general.protection', 'general.relockAfter'])
  })

  test('turned on, offers Protect and Remove protection in every menu', async () => {
    await turnProtection(true)
    expect(hiddenKinds.hidden).toEqual([PROTECTION_WORD])
    expect(ids(PLANS)).toEqual(['protect'])
    expect(ids(ROOT)).toEqual(['protect'])
    expect(asked.details).toEqual([])
  })

  test('turned off with items still protected, asks first, and they stay locked', async () => {
    workspace.protection.set(ROOT, DIARY, 'password')
    asked.answer = false
    await turnProtection(false)
    expect(asked.details).toEqual([
      '1 item is still protected. It stays locked; unprotect it first to remove protection.',
    ])
    expect(protectionOn()).toBe(true)

    asked.answer = true
    await turnProtection(false)
    expect(hiddenKinds.hidden).toEqual([NO_PROTECTION_WORD])
    expect(protectionOn()).toBe(false)
    expect(ids(PLANS)).toEqual([])
    expect(ids(DIARY)).toEqual([])
    expect(workspace.protection.locked(DIARY)).toBe(true)
    expect(workspace.protection.covering(DIARY)).toEqual([LOCK])

    unlocks.unlock([LOCK])
    expect(workspace.protection.locked(DIARY)).toBe(false)
    expect(ids(DIARY)).toEqual(['lock', 'agents'])
    unlocks.lockAll()
    expect(workspace.protection.locked(DIARY)).toBe(true)
  })

  test('turned off with nothing protected, goes without asking', async () => {
    await turnProtection(true)
    await turnProtection(false)
    expect(asked.details).toEqual([])
    expect(hiddenKinds.hidden).toEqual([NO_PROTECTION_WORD])
  })
})
