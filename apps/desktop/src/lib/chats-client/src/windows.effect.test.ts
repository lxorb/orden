import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../accounts/src/account.svelte', () => ({ account: { accountToken: null } }))
const { hush } = await import('./hush.svelte')
const { priorities } = await import('./priorities.svelte')
function anotherWindowWrote(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new StorageEvent('storage', { key }))
}
afterEach(() => localStorage.clear())
describe('chat settings changed in another window', () => {
  test('keep its keywords when this window turns the sound on', () => {
    anotherWindowWrote('orden.chat-hush', {
      keywords: ['thesis'],
      hours: null,
      previews: true,
      sound: false,
    })
    hush.setSound(true)
    expect(JSON.parse(localStorage.getItem('orden.chat-hush') ?? '{}')).toMatchObject({
      keywords: ['thesis'],
      sound: true,
    })
  })
  test('keep its priority lessons when this window turns drafting on', () => {
    const lesson = { title: 'Lunch', from: 'Lucile', words: 'fire!', level: 'urgent' }
    anotherWindowWrote('orden:chat-priorities', {
      on: true,
      drafting: false,
      assigned: {},
      lessons: [lesson],
    })
    priorities.setDrafting(true)
    expect(JSON.parse(localStorage.getItem('orden:chat-priorities') ?? '{}')).toMatchObject({
      on: true,
      drafting: true,
      lessons: [lesson],
    })
  })
})
