import { describe, expect, test, vi } from 'vitest'
import type { AccountDouble } from '../../accounts/test/fakes'
import { headingAbove, sentWords } from '../src/sent-words'
import { levelWord } from '../src/level-words'
import { recordVoice } from '../src/voice'

const held = vi.hoisted(() => ({ account: null as AccountDouble | null }))
vi.mock('../../accounts/src/account.svelte', async () => {
  held.account = (await import('../../accounts/test/fakes')).accountDouble()
  return { account: held.account }
})
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
