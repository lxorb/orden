import { EVERYTHING, fakeProvider, SEND_ONLY, type FakeOptions } from '@orden/chats/fake-provider'
import type { Host, ProviderMessage } from '@orden/chats/provider'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Shown } from './api'
import { connected as hub } from './connected.svelte'
import { conversationKey } from './conversation-key'
import { sentText, shownText } from './formats'
import { hush } from './hush.svelte'
import { priorityNotice, quiet } from './prioritise'
import { abilitiesOf, whoOf } from './remote.svelte'
import { remoteOf } from './remotes'
import { chats } from './store.svelte'
import { ChatPage, ORDEN_CAN } from './view/chat.svelte'
import { messageMenu } from './view/message-menu'
import { nameOf } from './view/people'
import { seeded } from './view/seed'
import { store, useStore } from './view/source.svelte'

const host: Host = {
  secret: () => Promise.resolve(null),
  keepSecret: () => Promise.resolve(),
  fetch: globalThis.fetch,
  now: () => Date.now(),
}

afterEach(async () => {
  useStore(chats)
  for (const one of hub.linked) await hub.unlink(one.provider.id, one.account.id)
})

async function linked(options: FakeOptions = {}) {
  const fake = fakeProvider(options)
  const link = await hub.link(fake, { name: 'acct' }, host)
  const chat = (conversation: string) =>
    conversationKey({ provider: fake.id, account: link.account.id, conversation })
  return { fake, link, chat }
}

async function opened(chat: string): Promise<ChatPage> {
  const page = new ChatPage(chat)
  await vi.waitFor(() => expect(page.messages.length).toBeGreaterThan(0))
  return page
}

const labels = (page: ChatPage, message: Shown) =>
  messageMenu(page, message, page.view.role, {
    reply: () => undefined,
    quote: () => undefined,
    edit: () => undefined,
  }).flatMap((one) => (one && 'label' in one ? [one.label] : []))

describe("another service's conversation in Orden's chat view", () => {
  test('its messages read as the service wrote them, with its people as nobody of Orden', async () => {
    const { chat } = await linked()
    const page = await opened(chat('ada'))
    const [hello, mine, sketch, voice, sticker, gif, link] = page.messages
    expect(hello?.author).toBe(whoOf('ada'))
    expect(nameOf(hello?.author ?? 'guest:x', page.members, null)).toBe('Ada Lovelace')
    expect(page.me).toBe(whoOf('me'))
    expect(mine?.author).toBe(page.me)
    expect(mine?.delivery).toBe('read')
    expect(sketch?.quote).toBe(mine?.id)
    expect(sketch?.files[0]).toMatchObject({ type: 'image/png', width: 64, height: 48 })
    expect(voice?.files[0]).toMatchObject({ type: 'audio/wav', seconds: 2 })
    expect(voice?.files[0]?.wave?.length).toBe(8)
    expect(sticker?.files[0]?.loop).toBe(true)
    expect(gif?.files[0]?.loop).toBe(true)
    expect(link?.preview?.title).toBe('The plan')
    const url = await store().fileUrl(chat('ada'), sketch?.files[0]?.hash ?? '')
    expect(url).toMatch(/^blob:/)
    page.close()
  })

  test('reactions, polls, threads, edits, deletions and system lines come across', async () => {
    const { chat } = await linked()
    const page = await opened(chat('team'))
    const byText = (text: string) => page.messages.find((one) => one.body === text)
    expect(page.messages[0]?.system).toBe(true)
    const parent = byText('Where do we meet?')
    expect(parent?.reactions['👍']).toEqual([whoOf('ada'), page.me])
    expect(parent?.replies).toBe(1)
    expect(page.messages.some((one) => one.body === 'At the lab')).toBe(false)
    const poll = page.messages.find((one) => one.poll)
    expect(poll?.tally).toEqual([2, 1])
    expect(byText('Fixed the typo')?.editedAt).toBeDefined()
    expect(page.messages.find((one) => one.deleted)).toBeDefined()
    expect(byText('From elsewhere')?.forwarded).toBe(true)
    expect(byText('@me can you look?')?.mentions).toEqual([page.me])

    const replies = page.view.replies(parent?.id ?? '')
    await vi.waitFor(() => expect(replies.messages.map((one) => one.body)).toEqual(['At the lab']))
    replies.close()

    if (poll) page.vote(poll, [0])
    await vi.waitFor(() => expect(page.messages.find((one) => one.poll)?.tally).toEqual([3, 1]))
    page.close()
  })

  test('new, changed and deleted messages, typing, presence and receipts are heard', async () => {
    const { fake, chat } = await linked()
    const page = await opened(chat('ada'))
    const world = fake.world
    const said = world.say('ada', 'ada', 'Are you there?')
    await vi.waitFor(() => expect(page.messages.at(-1)?.body).toBe('Are you there?'))
    world.changeMessage('ada', said.id, { text: 'Are you around?', editedAt: Date.now() })
    await vi.waitFor(() => expect(page.messages.at(-1)?.body).toBe('Are you around?'))
    world.tell({ t: 'deleted', conversation: 'ada', message: said.id })
    await vi.waitFor(() => expect(page.messages.some((one) => one.id === said.id)).toBe(false))

    world.tell({ t: 'typing', conversation: 'ada', person: 'ada', on: true })
    await vi.waitFor(() => expect(page.view.presence.typing).toEqual([{ who: whoOf('ada') }]))
    world.tell({ t: 'presence', person: 'ada', online: false })
    await vi.waitFor(() => expect(page.view.presence.here).not.toContain(whoOf('ada')))
    world.tell({ t: 'presence', person: 'ada', online: true })
    await vi.waitFor(() => expect(page.view.presence.here).toContain(whoOf('ada')))
    const last = page.messages.at(-1)
    world.tell({ t: 'read', conversation: 'ada', person: 'ada', upTo: last?.id ?? '' })
    await vi.waitFor(() => expect(page.view.presence.reads.get(whoOf('ada'))).toBe(last?.seq))
    page.close()
  })

  test('sending goes with its file, quote and thread, and a failed send can be tried again', async () => {
    const { fake, chat } = await linked()
    const page = await opened(chat('team'))
    const parent = page.messages.find((one) => one.body === 'Where do we meet?')
    const hash = await store().upload(new Uint8Array([1, 2, 3]), chat('team'))
    expect(hash).toMatch(/^local:/)
    page.aside = parent ? { kind: 'quote', message: parent } : null
    page.post('see **this**', {
      files: [{ hash: hash ?? '', name: 'a.bin', size: 3, type: 'application/octet-stream' }],
    })
    await vi.waitFor(() => expect(fake.world.calls.some((one) => one.method === 'send')).toBe(true))
    const sent = fake.world.calls.find((one) => one.method === 'send')?.args[1] as {
      text: string
      replyTo?: string
      attachments?: { bytes: Uint8Array; kind: string }[]
    }
    expect(sent.text).toBe('see **this**')
    expect(sent.replyTo).toBe(parent?.id)
    expect([...(sent.attachments?.[0]?.bytes ?? [])]).toEqual([1, 2, 3])
    expect(sent.attachments?.[0]?.kind).toBe('file')
    await vi.waitFor(() => expect(page.messages.at(-1)?.delivery).toBe('delivered'))

    const original = fake.connection
    const send = original ? original.send.bind(original) : null
    let fail = true
    if (fake.connection)
      fake.connection.send = (conversation, draft) =>
        fail
          ? Promise.reject(new Error('offline'))
          : (send?.(conversation, draft) ?? Promise.reject(new Error('gone')))
    page.post('again')
    await vi.waitFor(() => expect(page.view.pending.at(-1)?.refused).toBe('invalid'))
    fail = false
    page.retry(page.view.pending.at(-1)?.id ?? '')
    await vi.waitFor(() => expect(page.messages.at(-1)?.body).toBe('again'))
    await vi.waitFor(() => expect(page.view.pending).toEqual([]))
    page.close()
  })

  test('reading tells the service, and so does marking unread', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { fake, chat } = await linked()
    fake.world.say('ada', 'ada', 'new one')
    const page = await opened(chat('ada'))
    expect(page.view.lineAt).toBeLessThan(page.messages.at(-1)?.seq ?? 0)
    page.seen(page.messages.at(-1)?.seq ?? 0)
    await vi.advanceTimersByTimeAsync(600)
    expect(fake.world.calls.some((one) => one.method === 'markRead')).toBe(true)
    const message = page.messages.at(-1)
    if (message) page.markUnread(message)
    expect(fake.world.calls.some((one) => one.method === 'markUnread')).toBe(true)
    vi.useRealTimers()
    page.close()
  })
})

describe('what a service cannot do is not offered', () => {
  test('a service that only sends offers no thread, quote, reaction, pin, edit or delete', async () => {
    const { chat, fake } = await linked({ can: SEND_ONLY, methods: [] })
    const page = await opened(chat('ada'))
    expect(page.can).toMatchObject({
      files: false,
      voice: false,
      polls: false,
      quote: false,
      threads: false,
      react: null,
      editFor: null,
      removeFor: null,
      removeForMe: false,
      pin: false,
      vote: false,
      markUnread: false,
      members: false,
      topic: false,
      mute: false,
      search: false,
      link: false,
      schedule: false,
      unsend: false,
      stickers: false,
      gifs: false,
    })
    const mine = page.messages.find((one) => one.author === page.me)
    expect(mine && labels(page, mine)).toEqual(['Copy', 'Save', 'Add as task', 'Save as note'])
    expect(abilitiesOf(fake, fake.connection ?? ({} as never), null).react).toBeNull()
    page.close()
  })

  test('a full service offers both deletes, and editing only inside its window', async () => {
    const { chat } = await linked({ can: { ...EVERYTHING, editFor: 60_000, removeFor: 60_000 } })
    const page = await opened(chat('ada'))
    const old = page.messages.find((one) => one.author === page.me)
    if (!old) throw new Error('no own message')
    expect(labels(page, old)).toEqual([
      'Reply',
      'Quote',
      'Copy',
      'Pin',
      'Save',
      'Add as task',
      'Save as note',
      'Mark unread',
      'Delete for me',
    ])
    page.post('fresh')
    await vi.waitFor(() => expect(page.messages.at(-1)?.body).toBe('fresh'))
    const fresh = page.messages.at(-1)
    expect(fresh && labels(page, fresh)).toEqual(
      expect.arrayContaining(['Edit', 'Delete for everyone', 'Delete for me']),
    )
    const theirs = page.messages.find((one) => one.author !== page.me)
    expect(theirs && labels(page, theirs)).not.toContain('Delete for everyone')
    page.close()
  })

  test('one reaction each replaces the last at once', async () => {
    const { chat } = await linked({ can: { ...EVERYTHING, reactions: 'one' } })
    const page = await opened(chat('team'))
    const parent = page.messages.find((one) => one.body === 'Where do we meet?')
    if (!parent) throw new Error('no message')
    page.react(parent, '🎉')
    await vi.waitFor(() => {
      const now = page.messages.find((one) => one.id === parent.id)
      expect(now?.reactions['🎉']).toEqual([page.me])
      expect(now?.reactions['👍']).toEqual([whoOf('ada')])
    })
    page.close()
  })
})

describe("Orden's own chats behind the same front", () => {
  test('pass straight through, with everything Orden can do', () => {
    const { store: fixture, general } = seeded()
    useStore(fixture)
    expect(store().entry(general)).toBe(fixture.entry(general))
    expect(store().list).toBe(fixture.list)
    expect(store().me).toBe(fixture.me)
    const page = new ChatPage(general)
    expect(page.can).toBe(ORDEN_CAN)
    expect(page.service).toBeNull()
    const own = page.messages.find((one) => one.author === fixture.me && !one.deleted && !one.poll)
    if (own) {
      const said = labels(page, own)
      expect(said).toEqual(
        expect.arrayContaining([
          'Reply',
          'Quote',
          'Copy link',
          'Pin',
          'Mark unread',
          'Edit',
          'Delete',
        ]),
      )
      expect(said).not.toContain('Delete for me')
    }
    expect(remoteOf(general)).toBeNull()
    page.close()
  })
})

describe('words between formats', () => {
  test("Slack's marks are read as Markdown and written back", () => {
    expect(shownText('*bold* _it_ ~gone~ <https://a.org|A>', 'mrkdwn')).toBe(
      '**bold** *it* ~~gone~~ [A](https://a.org)',
    )
    expect(sentText('**bold** *it* ~~gone~~ [A](https://a.org)', 'mrkdwn')).toBe(
      '*bold* _it_ ~gone~ <https://a.org|A>',
    )
    expect(sentText('a < b & **c**', 'html')).toBe('a &lt; b &amp; <b>c</b>')
    expect(sentText('**c** [x](https://y.org)', 'plain')).toBe('c x (https://y.org)')
  })
})

describe('notifying', () => {
  test('a muted conversation, or one set to nothing, does not notify', async () => {
    const { fake, link, chat } = await linked()
    const message = fake.world.say('ada', 'ada', 'ping')
    expect(quiet(fake.id, link.account.id, 'ada', message)).toBe(false)
    fake.world.change('ada', { mutedUntil: Date.now() + 60_000 })
    await vi.waitFor(() => expect(quiet(fake.id, link.account.id, 'ada', message)).toBe(true))
    fake.world.change('ada', { mutedUntil: null })
    await vi.waitFor(() => expect(quiet(fake.id, link.account.id, 'ada', message)).toBe(false))
    await store().notifyFor(chat('ada'), 'mentions', null)
    expect(quiet(fake.id, link.account.id, 'ada', message)).toBe(true)
    const called = fake.world.say('ada', 'ada', '@me', { mentions: ['me'] })
    expect(quiet(fake.id, link.account.id, 'ada', called)).toBe(false)
  })

  test('quiet hours hush a priority notice, and with previews off it names neither person nor words', async () => {
    const { fake, link } = await linked()
    const message = fake.world.say('ada', 'ada', 'secret plans')
    expect(quiet(fake.id, link.account.id, 'ada', message)).toBe(false)
    hush.setHours({ days: [], from: 0, to: 0 })
    try {
      expect(quiet(fake.id, link.account.id, 'ada', message)).toBe(true)
    } finally {
      hush.setHours(null)
    }
    const key = { provider: fake.id, account: link.account.id, conversation: 'ada' }
    hush.setPreviews(false)
    try {
      const notice = priorityNotice(key, 'Ada', message)
      expect(notice.title).not.toContain('Ada')
      expect(notice.body).toBe('')
      expect(notice.tag).toBe(conversationKey(key))
    } finally {
      hush.setPreviews(true)
    }
  })
})

describe('a service that drops and comes back', () => {
  test('what came while it was away is shown when it is back', async () => {
    const { fake, link, chat } = await linked()
    const page = await opened(chat('ada'))
    fake.world.tell({ t: 'status', status: 'offline' })
    fake.world.put({
      id: 'away-1',
      conversation: 'ada',
      author: fake.world.person('ada'),
      at: Date.now(),
      text: 'said while you were away',
      attachments: [],
      mine: false,
    })
    fake.world.tell({ t: 'status', status: 'online' })
    await vi.waitFor(() => expect(page.messages.at(-1)?.body).toBe('said while you were away'))
    await vi.waitFor(() =>
      expect(
        hub.find(fake.id, link.account.id)?.conversations.find((one) => one.id === 'ada')?.snippet,
      ).toBe('said while you were away'),
    )
    page.close()
  })
})

describe('what is on its way out', () => {
  test('a send still going, or one that failed, is there again when the chat is opened anew', async () => {
    const { fake, chat } = await linked()
    const page = await opened(chat('ada'))
    let release: () => void = () => undefined
    const send = fake.connection?.send.bind(fake.connection)
    if (!send || !fake.connection) throw new Error('not connected')
    fake.connection.send = (conversation, draft) =>
      draft.text === 'slow'
        ? new Promise<void>((resolve) => (release = resolve)).then(() => send(conversation, draft))
        : Promise.reject(new Error('offline'))
    page.post('lost?')
    await vi.waitFor(() => expect(page.view.pending.at(-1)?.refused).toBe('invalid'))
    page.post('slow')
    await vi.waitFor(() => expect(page.view.pending.map((one) => one.body)).toContain('slow'))
    page.close()
    const again = await opened(chat('ada'))
    expect(again.view.pending.map((one) => one.body).sort()).toEqual(['lost?', 'slow'])
    release()
    await vi.waitFor(() => expect(again.messages.at(-1)?.body).toBe('slow'))
    await vi.waitFor(() => expect(again.view.pending.map((one) => one.body)).toEqual(['lost?']))
    again.close()
  })

  test('a reaction or vote the service refuses is taken back', async () => {
    const { fake, chat } = await linked()
    const page = await opened(chat('team'))
    const parent = page.messages.find((one) => one.body === 'Where do we meet?')
    const poll = page.messages.find((one) => one.poll)
    if (!parent || !poll || !fake.connection) throw new Error('no message')
    fake.connection.react = () => Promise.reject(new Error('refused'))
    fake.connection.vote = () => Promise.reject(new Error('refused'))
    await expect(store().react(chat('team'), parent.id, '🎉', true)).rejects.toThrow()
    await expect(store().vote(chat('team'), poll.id, [0])).rejects.toThrow()
    const now = (id: string) => page.messages.find((one) => one.id === id)
    expect(now(parent.id)?.reactions['🎉']).toBeUndefined()
    expect(now(poll.id)?.tally).toEqual([2, 1])
    page.close()
  })
})

describe('older pages', () => {
  test('a reply in a thread stays in its thread when older messages are loaded', async () => {
    const { fake, chat } = await linked()
    const connection = fake.connection
    if (!connection) throw new Error('not connected')
    const ada = fake.world.person('ada')
    const message = (id: string, at: number, more: Partial<ProviderMessage> = {}) => ({
      id,
      conversation: 'news',
      author: ada,
      at,
      text: id,
      attachments: [],
      mine: false,
      ...more,
    })
    connection.history = (_conversation, ask) =>
      Promise.resolve(
        ask.before
          ? {
              messages: [message('first', 1_000), message('in-thread', 2_000, { thread: 'first' })],
              before: null,
            }
          : { messages: [message('newest', 3_000)], before: 'newest' },
      )
    const page = await opened(chat('news'))
    await page.view.older()
    expect(page.messages.map((one) => one.body)).toEqual(['first', 'newest'])
    page.close()
  })
})

describe('what is heard twice or never looked at', () => {
  test('a message told twice counts once, and a chat nobody opened keeps no messages', async () => {
    const { fake, link, chat } = await linked()
    const unread = () =>
      hub.find(fake.id, link.account.id)?.conversations.find((one) => one.id === 'news')?.unread
    const before = unread() ?? 0
    const message = fake.world.say('news', 'ada', 'once only')
    fake.world.tell({ t: 'message', message })
    expect(unread()).toBe(before + 1)
    expect(remoteOf(chat('news'))?.known.has('news')).toBe(false)
  })
})

describe('a conversation the list does not have yet', () => {
  test('its first message brings it into the list', async () => {
    const { fake, link } = await linked()
    fake.world.conversations = [
      ...fake.world.conversations,
      {
        id: 'stranger',
        title: 'Stranger',
        kind: 'direct',
        people: [fake.world.person('cy')],
        lastAt: null,
        unread: 0,
      },
    ]
    fake.world.say('stranger', 'cy', 'hi, we have not met')
    await vi.waitFor(() =>
      expect(
        hub.find(fake.id, link.account.id)?.conversations.find((one) => one.id === 'stranger')
          ?.unread,
      ).toBe(1),
    )
  })
})

describe('marking unread', () => {
  test('the list counts the chat unread though the service says nothing back', async () => {
    const { fake, link, chat } = await linked()
    if (fake.connection) fake.connection.markUnread = () => Promise.resolve()
    const page = await opened(chat('news'))
    page.seen(page.messages.at(-1)?.seq ?? 0)
    const unread = () =>
      hub.find(fake.id, link.account.id)?.conversations.find((one) => one.id === 'news')?.unread
    await vi.waitFor(() => expect(unread()).toBe(0))
    const last = page.messages.at(-1)
    if (last) page.markUnread(last)
    expect(unread()).toBe(1)
    page.close()
  })
})
