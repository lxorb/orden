import { describe, expect, test, vi } from 'vitest'
import { askPart, chatReplies, chatsUnread, helperRun, lookAtLaunch, type Panel } from '../src/api'

const LOCAL = {
  id: 'compatible-1',
  kind: 'compatible',
  name: 'Ollama',
  model: 'llama',
  baseUrl: 'http://x',
} as const
const world = vi.hoisted((): { parent: unknown; children: unknown[] } => ({ parent: null, children: [] }))
vi.mock('../../workspace/src/api', () => ({
  workspace: { active: null, spaces: [{ id: 'Notes', root: '/n' }], activeSpace: { id: 'Notes' } },
}))
vi.mock('../../gates/src/api', () => ({ chatsOn: () => true }))
vi.mock('../../ai-providers/src/keys', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readKey: () => Promise.resolve('sk-test'),
}))
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ai: { providers: [{ id: 'compatible-1', kind: 'compatible', name: 'Ollama', model: 'llama', baseUrl: 'http://x' }] },
  usable: () => true,
}))
vi.mock('../src/commands/found', () => ({
  rootOfSpace: () => '/n',
  foundNamed: () => Promise.resolve(null),
  wordsOf: () => Promise.resolve(''),
}))
vi.mock('../src/store/chat.svelte', () => ({
  chat: {
    threadOf: (id: string) => ((world.parent as { id: string } | null)?.id === id ? world.parent : null),
    loadModels: () => Promise.resolve([]),
    adopt: () => undefined,
    turn: (thread: unknown) => {
      world.children.push(thread)
      return Promise.resolve({ stop: 'end', turn: null, usage: null })
    },
  },
}))
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
describe('a helper', () => {
  test('never reaches a tool its parent chat may not, nor works in a wider mode', async () => {
    const { newThread } = await import('../src/chat/threads')
    const parent = {
      ...newThread('Notes', LOCAL.id, 'llama', 'auto', 'approve'),
      without: ['browser_open', 'edit_note'],
      only: ['read_note', 'edit_note', 'list_tasks'],
    }
    world.parent = parent
    const { runAgent } = await helperRun()
    const said = await runAgent({ prompt: 'Find the herons.' }, { thread: parent.id, mode: 'full' })
    expect(said).not.toHaveProperty('refused')
    const child = world.children[0] as typeof parent
    expect(child.parent).toBe(parent.id)
    expect(child.mode).toBe('approve')
    expect(child.without).toEqual(expect.arrayContaining(['browser_open', 'edit_note']))
    expect(child.only).toEqual(['read_note', 'edit_note', 'list_tasks'])
    const listed: string[][] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (url.includes('/models')) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'llama' }] })))
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
        tools?: { function: { name: string } }[]
      }
      listed.push((body.tools ?? []).map((one) => one.function.name))
      const said = [
        { choices: [{ delta: { content: 'Herons.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]
      return Promise.resolve(
        new Response(said.map((one) => `data: ${JSON.stringify(one)}\n\n`).join('') + 'data: [DONE]\n\n'),
      )
    })
    const { createApiEngine } = await import('../src/chat/engine')
    const tool = (name: string) => ({ name, description: name, inputSchema: { type: 'object' } })
    const engine = createApiEngine({
      provider: (id) => (id === LOCAL.id ? LOCAL : null),
      tools: {
        list: () =>
          Promise.resolve({
            instructions: '',
            tools: [tool('read_note'), tool('browser_open'), tool('edit_note'), tool('run_terminal')],
          }),
        call: () => Promise.resolve({ text: '', images: [], error: false }),
        context: () => Promise.resolve(''),
      },
    })
    await engine.send(
      child,
      { text: 'Find the herons.', attachments: [] },
      () => undefined,
      new AbortController().signal,
    )
    vi.unstubAllGlobals()
    expect(listed).toEqual([['read_note']])
  })
})
