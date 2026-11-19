import { describe, expect, test, vi } from 'vitest'
import { askPart, chatReplies, chatsUnread, lookAtLaunch, type Panel } from '../src/api'

vi.mock('../../workspace/src/api', () => ({ workspace: { active: null } }))
vi.mock('../../gates/src/api', () => ({ chatsOn: () => true }))
describe('the unread mark', () => {
  test('stays off while there is no space to look in', async () => {
    await lookAtLaunch([])
    expect(chatsUnread.any).toBe(false)
  })
  test('is what the Ask panel’s sidebar part says, beside its new chat and threads tools', () => {
    expect(askPart.unread?.()).toBe(false)
    chatsUnread.any = true
    expect(askPart.unread?.()).toBe(true)
    chatsUnread.any = false
    expect(askPart.tools?.map((one) => [one.id, one.label, one.command])).toEqual([
      ['new-chat', 'New chat', undefined],
      ['threads', 'Chats', 'app.ask'],
    ])
    expect(typeof askPart.toTab).toBe('function')
  })
})
describe('a reply drafted for a chat', () => {
  test('sends nothing while no module lends the chats', async () => {
    const { draftReply } = await chatReplies()
    const sent: string[] = []
    const panel = { send: (text: string) => void sent.push(text) } as Partial<Panel> as Panel
    const thread = { id: 't1', turns: [] } as unknown as Parameters<typeof draftReply>[1]
    await expect(draftReply(panel, thread, 'c1', 'say yes')).resolves.toBe(false)
    expect(sent).toEqual([])
  })
})
describe('an answer naming a path on another host', () => {
  const ELSEWHERE = [
    '\\\\server\\share\\a.md',
    '//server/share/a.md',
    '\\/server/share',
    '/\\server\\share',
    '\\\\?\\UNC\\server\\share\\a.md',
    '\\\\.\\UNC\\server\\share',
    'file://server/share/a.md',
    'file:///C:/a.md',
  ]
  test('is never a link, nor placed anywhere, on any system, in words or in code', async () => {
    const { placeOf, withPaths } = await import('../src/store/paths')
    for (const system of ['windows', 'macos', 'linux']) {
      const here = {
        root: system === 'windows' ? 'C:\\Notes' : '/Users/me/Notes',
        system,
        spaces: [{ root: system === 'windows' ? 'C:\\Notes' : '/Users/me/Notes' }],
        holds: () => true,
        opens: () => true,
        reveals: true,
      }
      for (const path of ELSEWHERE) {
        const written = path.replace(/&/g, '&amp;')
        expect(withPaths(`<p>${written}</p><p><code>${written}</code></p>`, here)).not.toContain('data-path')
        expect(placeOf(path, here, system === 'windows' ? 'C:\\Users\\me' : '/Users/me')).toBeNull()
      }
    }
  })
})
