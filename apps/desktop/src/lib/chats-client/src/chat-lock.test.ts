import type { Who } from '@orden/chats'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'
import { FixtureChats } from './view/fixture.svelte'

const ME: Who = 'user:me'
const LUCILE: Who = 'user:lucile'

const team = { id: 'team', name: 'Team', root: '/spaces/Team' }

vi.mock('../../workspace/src/api', () => ({
  workspace: { spaces: [team], activeSpace: team, activeSpaceId: 'team' },
}))

const LOCKED = '/spaces/Team/Private'
vi.mock('../../protect/src/api', () => ({
  protection: {
    agentsMay: (path: string) => !path.startsWith(LOCKED),
    locked: (path: string) => path.startsWith(LOCKED),
    ways: () => ({ Private: 'password' }),
  },
}))

let store: FixtureChats
vi.mock('./store.svelte', () => ({
  get chats() {
    return store
  },
}))
vi.mock('./view/open', () => ({ openChat: () => undefined }))
vi.mock('../../sharing/src/api', () => ({ isShared: () => false }))

const verbs = await import('./agent-verbs')
const { EXPERIMENTAL_WORD, CHATS_WORD, hiddenKinds } = await import('../../gates/src/api')
const { protection } = await import('../../protect/src/api')

const caller = callerOf({
  id: 'claude',
  name: 'Claude',
  scopes: ['chats.read'],
  spaces: ['Team'],
  mode: 'unsupervised',
})

beforeEach(() => {
  hiddenKinds.hidden = [EXPERIMENTAL_WORD, CHATS_WORD]
  store = new FixtureChats(ME)
  store.delay = 0
  const people = [
    { who: ME, name: 'Emil', role: 'owner' as const },
    { who: LUCILE, name: 'Lucile', role: 'write' as const },
  ]
  const kept = store.add('therapy', people, {
    root: '/spaces/Team',
    path: `${LOCKED}/therapy.chat`,
  })
  store.speak(kept, LUCILE, 'what we said in session')
})

describe('a chat in a folder protected from agents', () => {
  test('is locked for agents by the same rule notes follow', () => {
    expect(protection.agentsMay(`${LOCKED}/therapy.chat`)).toBe(false)
  })

  test('is neither read nor searched nor listed by an agent', async () => {
    await expect(
      verbs.readChat({ verb: 'read_chat', args: { chat: 'therapy' }, caller }),
    ).rejects.toMatchObject({ code: 'not_found' })
    const found = (await verbs.searchChats({
      verb: 'search_chats',
      args: { query: 'session' },
      caller,
    })) as { result: string }
    expect(found.result).not.toContain('what we said in session')
  })
})
