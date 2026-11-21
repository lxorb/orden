import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { AccountDouble } from '../../accounts/test/fakes'
import { headingAbove, sentWords } from '../src/sent-words'
import { levelWord } from '../src/level-words'
import { recordVoice } from '../src/voice'

const held = vi.hoisted(() => ({ account: null as AccountDouble | null }))
vi.mock('../../accounts/src/account.svelte', async () => {
  held.account = (await import('../../accounts/test/fakes')).accountDouble()
  return { account: held.account }
})
const asked = vi.hoisted(() => ({ panels: [] as string[], namings: 0, made: [] as string[][], hits: [] as unknown[] }))
const server = vi.hoisted(() => {
  const settings: Record<string, Record<string, unknown>> = {}
  return { settings, offline: false }
})
vi.mock('../../accounts/src/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  api: {
    saveSettings: (token: string, patch: Record<string, unknown>) => {
      if (server.offline) return Promise.reject(new Error('offline'))
      server.settings[token] = { ...server.settings[token], ...patch }
      return Promise.resolve({ settings: server.settings[token] })
    },
  },
}))
vi.mock('../../gates/src/api', () => ({ chatsOn: () => true }))
vi.mock('../../sharing/src/api', () => ({ canWriteAt: () => true }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    activeSpace: { root: '/spaces/Lab' },
    showPanel: (panel: string) => asked.panels.push(panel),
    startNaming: () => ++asked.namings,
    freeName: () => 'Chat.chat',
    loadTree: () => Promise.resolve(),
  },
}))
vi.mock('../src/view/source.svelte', () => ({
  store: () => ({
    ready: true,
    make: (dir: string, name: string) => {
      asked.made.push([dir, name])
      return Promise.resolve(null)
    },
    search: () => Promise.resolve(asked.hits),
  }),
}))
describe('a note sent to a chat', () => {
  test('is its link alone, or the quoted lines above a link to the heading they sit under', () => {
    expect(sentWords('Plan')).toBe('[[Plan]] ')
    expect(sentWords('Plan', { text: 'one\n\ntwo', heading: 'Goals' })).toBe('> one\n>\n> two\n\n[[Plan#Goals]] ')
  })
  test('finds the nearest heading above where the quote starts', () => {
    const text = '# Plan\n\n## Goals\nship it\n'
    expect(headingAbove(text, text.indexOf('ship'))).toBe('Goals')
    expect(headingAbove('no heading here', 5)).toBeNull()
  })
})
describe('how urgent a message is', () => {
  test('reads as a word for every level', () => {
    expect(['urgent', 'important', 'if-time', 'unimportant'].map((one) => levelWord(one as never))).toEqual([
      'Urgent',
      'Important',
      'If time',
      'Unimportant',
    ])
  })
})
describe('the voice', () => {
  test('is refused with a reason while no module has bound the voice port', async () => {
    await expect(recordVoice()).rejects.toThrow(/voice/)
  })
})
describe('the Chats view', () => {
  test('a new chat is named in the Chats list, never in the file tree (#2269)', async () => {
    const { makeChat } = await import('../src/view/open')
    const { chatsView } = await import('../src/view/chats-view.svelte')
    await makeChat()
    expect([asked.panels, asked.namings, chatsView.naming, asked.made]).toEqual([['chats'], 0, '/spaces/Lab', []])
    await makeChat('/spaces/Lab', 'Team')
    expect(asked.made).toEqual([['/spaces/Lab', 'Team']])
  })
  test('its search, once words are typed, lists the messages that match as well as the chats (#2269)', async () => {
    const { messagesFor } = await import('../src/view/found')
    const said = (id: string, deleted = false) => ({ chat: 'c1', message: { id, deleted } })
    asked.hits = [said('m1'), said('m2', true), said('m3')]
    expect(await messagesFor('   ')).toEqual([])
    expect((await messagesFor('plan')).map((one) => one.message.id)).toEqual(['m1', 'm3'])
    const panel = readFileSync(join(import.meta.dirname, '../src/view/ChatsPanel.svelte'), 'utf8')
    expect(panel).toMatch(/messagesFor\(asked\)/)
    expect(panel).toMatch(/\{#each hitsHere as one/)
  })
})
describe('what one account leaves behind (#2167)', () => {
  test('its chat priorities, lessons, drafted replies and notification words go when it is forgotten', async () => {
    const { priorities } = await import('../src/priorities.svelte')
    const { hush } = await import('../src/hush.svelte')
    priorities.reassign('c1', 'urgent', { title: 'Lab', from: 'Ada', words: 'the results are in' })
    priorities.suggestions = { c1: { reply: 'Thanks', todo: null, at: 1 } }
    hush.receive({ chatKeywords: ['thesis'], chatHours: null, chatPreviews: false, chatSound: true })
    held.account?.signOut()
    expect([priorities.assigned, priorities.lessons, priorities.suggestions]).toEqual([{}, [], {}])
    expect([hush.keywords, hush.hours, hush.previews, hush.sound]).toEqual([[], null, true, false])
  })
})
describe('the notification words, hours, previews and sound of another account (#2367)', () => {
  const kept = new Map<string, string>()
  beforeAll(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
  })
  afterAll(() => vi.unstubAllGlobals())
  const passedTo = (who: string) => {
    if (!held.account) throw new Error('no account')
    held.account.token = `token-${who}`
    held.account.user = { id: who, email: `${who}@example.com` } as never
  }
  const seen = (hush: { keywords: string[]; hours: unknown; previews: boolean; sound: boolean }) => [
    hush.keywords,
    hush.hours,
    hush.previews,
    hush.sound,
  ]
  test('are the defaults for an account that never chose them, even where the last one left without this window hearing it, and its own again for the same account', async () => {
    const { hush } = await import('../src/hush.svelte')
    server.settings = { 'token-alice': { chatKeywords: ['x'], chatSound: true } }
    passedTo('alice')
    hush.receive(server.settings['token-alice'] ?? {})
    expect(seen(hush)).toEqual([['x'], null, true, true])
    passedTo('bob')
    hush.receive({})
    expect(seen(hush)).toEqual([[], null, true, false])
    passedTo('alice')
    hush.receive(server.settings['token-alice'] ?? {})
    expect(seen(hush)).toEqual([['x'], null, true, true])
  })
  test('a change made offline reaches its own account when it signs in again, and never the next one', async () => {
    vi.useFakeTimers()
    const { hush } = await import('../src/hush.svelte')
    server.settings = { 'token-alice': { chatKeywords: ['x'], chatSound: true }, 'token-bob': {} }
    passedTo('alice')
    hush.receive(server.settings['token-alice'] ?? {})
    server.offline = true
    hush.setKeywords('thesis, lab')
    await vi.advanceTimersByTimeAsync(0)
    server.offline = false
    passedTo('bob')
    hush.receive({})
    await vi.advanceTimersByTimeAsync(0)
    expect(seen(hush)).toEqual([[], null, true, false])
    expect(server.settings['token-bob']).toEqual({})
    passedTo('alice')
    hush.receive(server.settings['token-alice'] ?? {})
    await vi.advanceTimersByTimeAsync(0)
    expect(server.settings['token-alice']).toEqual({ chatKeywords: ['thesis', 'lab'], chatSound: true })
    expect(seen(hush)).toEqual([['thesis', 'lab'], null, true, true])
    vi.useRealTimers()
  })
})
describe('a chat’s name (#2310)', () => {
  test('is its pointer’s name shown as every name is, without its ending', async () => {
    const { chatName } = await import('../src/pointers')
    expect([chatName('/s/Team.chat'), chatName('/s/Plan.md.chat'), chatName('/s/Notes')]).toEqual([
      'Team',
      'Plan.md',
      'Notes',
    ])
  })
})
