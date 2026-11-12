import { describe, expect, test } from 'vitest'
import { askChat, CHAT_AWAY, eraseChats } from '../src/chats/ask'
import {
  askFrom,
  challengeLooksRight,
  tooLong,
  unknownScopes,
  wantsWrite,
} from '../src/oauth/protocol'

type Env = Parameters<typeof askChat>[0]

function fakeChats(answer: (request: Request, id: string) => Response | Error): {
  env: Env
  asked: Request[]
} {
  const asked: Request[] = []
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: (request: Request) => {
        asked.push(request)
        const got = answer(request, id)
        return got instanceof Error ? Promise.reject(got) : Promise.resolve(got)
      },
    }),
  }
  return { env: { CHATS: namespace } as unknown as Env, asked }
}

describe('asking a chat', () => {
  test('addresses the chat by name and says which ask it is', async () => {
    const { env, asked } = fakeChats(() => new Response('ok'))
    const answer = await askChat(env, 'chat-1', 'state', { 'x-extra': 'yes' })
    expect(answer?.ok).toBe(true)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.headers.get('x-orden-chat-ask')).toBe('state')
    expect(asked[0]?.headers.get('x-orden-chat')).toBe('chat-1')
    expect(asked[0]?.headers.get('x-extra')).toBe('yes')
    expect(asked[0]?.method).toBe('GET')
  })

  test('asks once more when the object was reset, then gives up', async () => {
    let calls = 0
    const { env } = fakeChats(() => {
      calls += 1
      return calls === 1 ? new Error('reset') : new Response('ok')
    })
    expect((await askChat(env, 'chat-1', 'state'))?.ok).toBe(true)
    const { env: broken } = fakeChats(() => new Error('reset'))
    expect(await askChat(broken, 'chat-1', 'state')).toBeNull()
    expect(CHAT_AWAY).toMatch(/not answering/)
  })

  test('without a chats namespace, every ask answers null and erasing keeps the ids', async () => {
    const env = {} as unknown as Env
    expect(await askChat(env, 'chat-1', 'state')).toBeNull()
    expect(await eraseChats(env, ['a', 'b'])).toEqual(['a', 'b'])
  })

  test('erasing reports only the chats that acknowledged', async () => {
    const { env } = fakeChats((_request, id) =>
      id === 'gone' ? new Response('no', { status: 500 }) : new Response('ok'),
    )
    expect(await eraseChats(env, ['kept', 'gone', 'other'])).toEqual(['kept', 'other'])
  })
})

describe('the oauth protocol', () => {
  test('reads an ask from query fields and bounds each field', () => {
    const ask = askFrom({ client_id: 'c', redirect_uri: 'https://x/y', state: 's' })
    expect(ask).toEqual({
      client_id: 'c',
      redirect_uri: 'https://x/y',
      state: 's',
      code_challenge: '',
      scope: '',
      resource: '',
    })
    expect(tooLong(ask)).toBeNull()
    expect(tooLong({ ...ask, state: 'x'.repeat(1025) })).toBe('state')
  })

  test('knows its scopes and the shape of a PKCE challenge', () => {
    expect(unknownScopes('notes:read notes:write files:read')).toEqual(['files:read'])
    expect(wantsWrite(askFrom({ scope: 'notes:read' }))).toBe(false)
    expect(wantsWrite(askFrom({}))).toBe(true)
    expect(challengeLooksRight('a'.repeat(43))).toBe(true)
    expect(challengeLooksRight('a'.repeat(42))).toBe(false)
    expect(challengeLooksRight(`${'a'.repeat(42)}+`)).toBe(false)
  })
})
