import type { tl } from '@mtcute/core'
import Long from 'long'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChatProvider, Connection, ProviderEvent } from '../provider'
import { secretName } from '../provider'
import { channel, chat, dialog, failure, FakeHost, FakeTelegram, KEYS, text, user } from './fake'
import { API_HASH, API_ID, telegramProvider } from './index'
import { WORDS } from './login'

const MIA = user(2, 'Mia', {
  username: 'mia_k',
  status: { _: 'userStatusOffline', wasOnline: 1_700_000_000 },
})
const NOAH = user(3, 'Noah', {
  photo: { _: 'userProfilePhoto', photoId: Long.fromNumber(500), dcId: 2 },
})
const GROUP = chat(40, 'Family')
const TEAM = channel(45, 'Team', { creator: true })
const FORUM = channel(50, 'Forum', { forum: true })
const NEWS = channel(60, 'News', { megagroup: false, broadcast: true })
const TALK = channel(61, 'News talk')

const toMia: tl.TypePeer = { _: 'peerUser', userId: 2 }
const toGroup: tl.TypePeer = { _: 'peerChat', chatId: 40 }
const toTeam: tl.TypePeer = { _: 'peerChannel', channelId: 45 }
const toForum: tl.TypePeer = { _: 'peerChannel', channelId: 50 }
const toNews: tl.TypePeer = { _: 'peerChannel', channelId: 60 }

function world(fake = new FakeTelegram()): FakeTelegram {
  fake.answer('users.getUsers', () => [fake.me])
  fake.answer('messages.getDialogs', (request: tl.messages.RawGetDialogsRequest) =>
    request.folderId === 1
      ? {
          _: 'messages.dialogs',
          dialogs: [dialog({ _: 'peerUser', userId: 3 }, 3, { folderId: 1 })],
          messages: [text(3, { _: 'peerUser', userId: 3 }, 3, 'old')],
          chats: [],
          users: [NOAH],
        }
      : {
          _: 'messages.dialogs',
          dialogs: [
            dialog(toMia, 10, { unreadCount: 2, readOutboxMaxId: 8, pinned: true }),
            dialog(toGroup, 20, {
              notifySettings: { _: 'peerNotifySettings', muteUntil: 2_000_000_000 },
            }),
            dialog(toTeam, 30, { unreadMentionsCount: 1 }),
            dialog(toForum, 40),
            dialog(toNews, 50),
          ],
          messages: [
            text(10, toMia, 2, 'hi there\nsecond line'),
            text(20, toGroup, 1, 'dinner?', { out: true }),
            text(30, toTeam, 2, 'ship it'),
            text(40, toForum, 2, 'topic talk', {
              replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 7 },
            }),
            text(50, toNews, 0, 'headline', { fromId: toNews, post: true }),
          ],
          chats: [GROUP, TEAM, FORUM, NEWS, TALK],
          users: [MIA, NOAH],
        },
  )
  fake.answer('messages.getForumTopics', () => ({
    _: 'messages.forumTopics',
    count: 2,
    pts: 1,
    topics: [
      {
        _: 'forumTopic',
        id: 1,
        date: 1,
        peer: toForum,
        title: 'General',
        iconColor: 0,
        topMessage: 39,
        readInboxMaxId: 0,
        readOutboxMaxId: 0,
        unreadCount: 0,
        unreadMentionsCount: 0,
        unreadReactionsCount: 0,
        unreadPollVotesCount: 0,
        fromId: { _: 'peerUser', userId: 2 },
        notifySettings: { _: 'peerNotifySettings' },
      },
      {
        _: 'forumTopic',
        id: 7,
        date: 1,
        peer: toForum,
        title: 'Plans',
        iconColor: 0,
        topMessage: 40,
        readInboxMaxId: 0,
        readOutboxMaxId: 0,
        unreadCount: 3,
        unreadMentionsCount: 0,
        unreadReactionsCount: 0,
        unreadPollVotesCount: 0,
        fromId: { _: 'peerUser', userId: 2 },
        notifySettings: { _: 'peerNotifySettings' },
      },
    ],
    messages: [
      text(40, toForum, 2, 'topic talk', {
        replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 7 },
      }),
    ],
    chats: [FORUM],
    users: [MIA],
  }))
  return fake
}

function sent(
  id: number,
  peer: tl.TypePeer,
  words = '',
): (request: { randomId: Long }) => tl.TypeUpdates {
  return (request) => ({
    _: 'updates',
    updates: [
      { _: 'updateMessageID', id, randomId: request.randomId },
      {
        _: 'updateNewMessage',
        message: text(id, peer, 1, words, { out: true }),
        pts: 1,
        ptsCount: 1,
      },
    ],
    users: [],
    chats: [],
    date: 1,
    seq: 0,
  })
}

const bare = (fake: FakeTelegram) =>
  telegramProvider(async (setup) => {
    fake.setup = setup
    return fake
  })

const provider = (fake: FakeTelegram): ChatProvider => {
  const telegram = bare(fake)
  return {
    ...telegram,
    connect: (config, host, account) => telegram.connect({ ...KEYS, ...config }, host, account),
  }
}

async function linked(
  fake = world(),
  host = new FakeHost(),
): Promise<{ fake: FakeTelegram; host: FakeHost; connection: Connection; heard: ProviderEvent[] }> {
  host.replies = ['12345']
  const connection = await provider(fake).connect({ phone: '+41 79 000 00 01' }, host)
  const heard: ProviderEvent[] = []
  connection.start((event) => heard.push(event))
  await connection.conversations()
  return { fake, host, connection, heard }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the pasted API ID and hash', () => {
  test('Telegram is offered whatever the build, and asks for the id and hash as secrets', () => {
    const telegram = bare(new FakeTelegram())
    expect(telegram.available(new FakeHost())).toBe(true)
    const fields = telegram.fields.filter((one) => one.key === API_ID || one.key === API_HASH)
    expect(fields.map((one) => [one.key, one.secret, one.optional])).toEqual([
      [API_ID, true, undefined],
      [API_HASH, true, undefined],
    ])
  })

  test('a missing or misshapen id or hash is refused before Telegram is dialled', async () => {
    const fake = world()
    const telegram = bare(fake)
    for (const config of [
      { phone: '+41790000001' },
      { ...KEYS, [API_ID]: 'abc' },
      { ...KEYS, [API_ID]: '0' },
      { ...KEYS, [API_HASH]: 'not-a-hash' },
    ])
      await expect(telegram.connect(config, new FakeHost())).rejects.toThrow(
        'Paste the API ID and hash from my.telegram.org',
      )
    expect(fake.setup).toBeNull()
  })

  test('the id and hash reach the client', async () => {
    const { fake } = await linked()
    expect(fake.setup).toEqual({
      apiId: 12345,
      apiHash: '0123456789abcdef0123456789abcdef',
      session: null,
    })
  })
})

describe('signing in', () => {
  test('a phone number and the code sent to the app', async () => {
    const { host, connection, fake } = await linked()
    expect(host.asked).toEqual([{ kind: 'code', label: WORDS.code, note: WORDS.app }])
    expect(connection.account).toMatchObject({
      id: '1',
      label: 'Emil',
      self: { id: 'u1', phone: '+41790000001' },
    })
    expect(fake.readied).toBe(true)
    expect(host.secrets.get(secretName('telegram', '1', 'session'))).toBe('session-one')
  })

  test('a wrong code is asked again, an expired one is sent anew', async () => {
    const fake = world()
    const host = new FakeHost()
    fake.expireOnce = true
    host.replies = ['11111', '00000', '12-345']
    await provider(fake).connect({ phone: '0041790000001' }, host)
    expect(host.asked.map((one) => one.note)).toEqual([WORDS.app, WORDS.expired, WORDS.wrongCode])
  })

  test('two-step verification asks for the password with its hint, and again when wrong', async () => {
    const fake = world()
    fake.password = 'horse'
    const host = new FakeHost()
    host.replies = ['12345', 'pony', 'horse']
    const connection = await provider(fake).connect({ phone: '+41790000001' }, host)
    expect(host.asked.slice(1)).toEqual([
      { kind: 'password', label: WORDS.password, note: 'the usual' },
      { kind: 'password', label: WORDS.password, note: WORDS.wrongPassword },
    ])
    expect(connection.account.id).toBe('1')
  })

  test('without a phone number it shows a QR code that follows the new tokens, then takes it away', async () => {
    const fake = world()
    fake.password = 'horse'
    const host = new FakeHost()
    host.replies = ['horse']
    await provider(fake).connect({}, host)
    expect(host.shown).toEqual([
      { kind: 'qr', data: 'tg://login?token=first', label: WORDS.scan, note: WORDS.where },
      { kind: 'qr', data: 'tg://login?token=second', label: WORDS.scan, note: WORDS.where },
      null,
      null,
    ])
    expect(host.asked).toEqual([{ kind: 'password', label: WORDS.password, note: 'the usual' }])
  })

  test('cancelling while the QR code shows stops waiting for a scan and closes the client', async () => {
    const fake = world()
    fake.qrWaits = true
    const host = new FakeHost()
    const connecting = provider(fake).connect({}, host)
    await vi.waitFor(() => expect(host.shown.length).toBeGreaterThan(0))
    host.cancel()
    await expect(connecting).rejects.toThrow()
    expect(fake.closed).toBe(true)
    expect(host.stoppers.size).toBe(0)
    expect(host.shown.at(-1)).toBeNull()
  })

  test('an unknown number says so and closes the client', async () => {
    const fake = world()
    await expect(provider(fake).connect({ phone: '+0' }, new FakeHost())).rejects.toThrow(
      WORDS.badPhone,
    )
    expect(fake.closed).toBe(true)
  })

  test('the session is used again on the next launch without asking anything', async () => {
    const host = new FakeHost()
    host.secrets.set(secretName('telegram', '1', 'session'), 'kept-session')
    const fake = world()
    const connection = await provider(fake).connect({ phone: '+41790000001' }, host, '1')
    expect(fake.setup?.session).toBe('kept-session')
    expect(host.asked).toEqual([])
    expect(connection.account.id).toBe('1')
  })

  test('a session Telegram ended is forgotten and says to connect again', async () => {
    const host = new FakeHost()
    host.secrets.set(secretName('telegram', '1', 'session'), 'kept-session')
    const fake = world()
    fake.answer('users.getUsers', () => {
      throw failure('AUTH_KEY_UNREGISTERED')
    })
    await expect(provider(fake).connect({}, host, '1')).rejects.toThrow('Signed out of Telegram')
    expect(host.secrets.size).toBe(0)
    await expect(provider(world()).connect({}, host, '1')).rejects.toThrow('Signed out of Telegram')
  })

  test('a session ended while connected turns the account signed out', async () => {
    const { fake, host, heard, connection } = await linked()
    fake.answer('messages.getHistory', () => {
      throw failure('SESSION_REVOKED')
    })
    await expect(connection.history('u2', { limit: 10 })).rejects.toThrow()
    expect(heard).toContainEqual({
      t: 'status',
      status: 'signed-out',
      reason: 'Signed out of Telegram. Connect again.',
    })
    expect(host.secrets.size).toBe(0)
  })

  test('a long session goes sealed, with only a marker in the vault', async () => {
    const fake = world()
    fake.sessionText = 'x'.repeat(3000)
    const host = new FakeHost()
    host.replies = ['12345']
    await provider(fake).connect({ phone: '+41790000001' }, host)
    const name = secretName('telegram', '1', 'session')
    expect(host.secrets.get(name)?.startsWith('sealed:')).toBe(true)
    expect(new TextDecoder().decode(host.bigs.get(name))).toBe(fake.sessionText)
    const again = world()
    await provider(again).connect({}, host, '1')
    expect(again.setup?.session).toBe(fake.sessionText)
  })

  test('forgetting signs out at Telegram and wipes the session, also after the connection closed', async () => {
    const { fake, host, connection } = await linked()
    await connection.close()
    for (const [key, value] of Object.entries(KEYS))
      host.secrets.set(secretName('telegram', '1', key), value)
    const later = world()
    await provider(later).forget?.('1', host)
    expect(later.setup).toEqual({ apiId: 12345, apiHash: KEYS[API_HASH], session: 'session-one' })
    expect(later.loggedOut).toBe(true)
    expect(fake.closed).toBe(true)
    expect(host.secrets.size).toBe(0)
  })
})

describe('the conversation list', () => {
  test('has every kind of chat, forum topics apart, and the archive', async () => {
    const { connection } = await linked()
    const list = await connection.conversations()
    const byId = Object.fromEntries(list.map((one) => [one.id, one]))
    expect(Object.keys(byId).sort()).toEqual(['c40', 's45', 's50t1', 's50t7', 's60', 'u2', 'u3'])
    expect(byId.u2).toMatchObject({
      kind: 'direct',
      title: 'Mia',
      unread: 2,
      pinned: true,
      snippet: 'hi there',
    })
    expect(byId.c40).toMatchObject({
      kind: 'group',
      title: 'Family',
      mutedUntil: 2_000_000_000_000,
      members: 3,
    })
    expect(byId.s45).toMatchObject({ kind: 'group', role: 'owner', mentions: 1 })
    expect(byId.s60).toMatchObject({ kind: 'channel', readOnly: true })
    expect(byId.s50t7).toMatchObject({ title: 'Forum / Plans', unread: 3 })
    expect(byId.u3).toMatchObject({ archived: true, picture: 'u3' })
  })
})

describe('reading', () => {
  test('history pages back oldest first and jumps around a found message', async () => {
    const { fake, connection } = await linked()
    fake.answer('messages.getHistory', (request: tl.messages.RawGetHistoryRequest) => ({
      _: 'messages.messagesSlice',
      count: 100,
      topics: [],
      chats: [],
      users: [MIA],
      messages: [3, 2].map((id) =>
        text(request.offsetId ? request.offsetId - 5 + id : id + 10, toMia, 2, `m${id}`),
      ),
    }))
    const page = await connection.history('u2', { limit: 2 })
    expect(page.messages.map((one) => one.id)).toEqual(['12', '13'])
    expect(page.before).toBe('12')
    await connection.history('u2', { limit: 2, around: '40' })
    expect(fake.called('messages.getHistory').at(-1)).toMatchObject({
      offsetId: 41,
      addOffset: -1,
      limit: 2,
    })
  })

  test('a topic reads its replies, a channel post its comments from the discussion group', async () => {
    const { fake, connection } = await linked()
    fake.answer('messages.getReplies', (request: tl.messages.RawGetRepliesRequest) => ({
      _: 'messages.channelMessages',
      pts: 1,
      count: 1,
      topics: [],
      chats: [TALK],
      users: [NOAH],
      messages:
        request.msgId === 7
          ? [
              text(41, toForum, 2, 'plan', {
                replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 7 },
              }),
            ]
          : [text(900, { _: 'peerChannel', channelId: 61 }, 3, 'first!')],
    }))
    const topic = await connection.history('s50t7', { limit: 10 })
    expect(topic.messages.map((one) => [one.id, one.conversation])).toEqual([['41', 's50t7']])
    const thread = await connection.thread?.('s60', '50', { limit: 10 })
    expect(thread?.messages).toMatchObject([
      { id: 's61:900', conversation: 's60', thread: '50', text: 'first!' },
    ])
  })

  test('marking read uses the call each kind of chat needs', async () => {
    const { fake, connection, heard } = await linked()
    for (const name of ['messages.readHistory', 'channels.readHistory', 'messages.readDiscussion'])
      fake.answer(name, () => true)
    await connection.markRead?.('u2', '10')
    await connection.markRead?.('s45', '30')
    await connection.markRead?.('s50t7', '41')
    expect(fake.calls.slice(-3).map((one) => one._)).toEqual([
      'messages.readHistory',
      'channels.readHistory',
      'messages.readDiscussion',
    ])
    expect(heard).toContainEqual({
      t: 'conversation',
      conversation: expect.objectContaining({ id: 'u2', unread: 0 }),
    })
  })

  test('an attachment downloads, fetching the message again when its file reference expired', async () => {
    const { fake, connection } = await linked()
    const photo = (reference: string): tl.RawPhoto => ({
      _: 'photo',
      id: Long.fromNumber(9),
      accessHash: Long.ONE,
      fileReference: new TextEncoder().encode(reference),
      date: 1,
      dcId: 2,
      sizes: [{ _: 'photoSize', type: 'y', w: 10, h: 10, size: 3 }],
    })
    fake.answer('messages.getHistory', () => ({
      _: 'messages.messages',
      topics: [],
      chats: [],
      users: [],
      messages: [
        text(11, toMia, 2, '', { media: { _: 'messageMediaPhoto', photo: photo('old') } }),
      ],
    }))
    fake.answer('messages.getMessages', () => ({
      _: 'messages.messages',
      topics: [],
      chats: [],
      users: [],
      messages: [
        text(11, toMia, 2, '', { media: { _: 'messageMediaPhoto', photo: photo('new') } }),
      ],
    }))
    fake.files.set('9:y:new', new Uint8Array([7, 7, 7]))
    const page = await connection.history('u2', { limit: 1 })
    expect(page.messages[0]?.attachments[0]).toMatchObject({ ref: 'm', kind: 'image' })
    expect(await connection.attachment('u2', '11', 'm')).toEqual(new Uint8Array([7, 7, 7]))
    expect(fake.downloads.map((one) => one.dc)).toEqual([2, 2])
  })

  test('a picture comes from the peer photo', async () => {
    const { fake, connection } = await linked()
    fake.files.set('peer:500', new Uint8Array([1]))
    expect(await connection.picture?.('u3')).toEqual(new Uint8Array([1]))
    expect(await connection.picture?.('u2')).toBeNull()
  })

  test('search goes everywhere or stays in one conversation', async () => {
    const { fake, connection } = await linked()
    const found = {
      _: 'messages.messages',
      topics: [],
      chats: [],
      users: [],
      messages: [text(10, toMia, 2, 'needle'), text(30, toTeam, 2, 'needle')],
    }
    fake.answer('messages.searchGlobal', () => found)
    fake.answer('messages.search', () => found)
    expect((await connection.search?.('needle'))?.map((one) => one.conversation)).toEqual([
      'u2',
      's45',
    ])
    expect((await connection.search?.('needle', 'u2'))?.map((one) => one.conversation)).toEqual([
      'u2',
    ])
  })
})

describe('writing', () => {
  test('text goes out with its formatting, mention and reply, and comes back mapped', async () => {
    const { fake, connection } = await linked()
    fake.answer('messages.sendMessage', sent(11, toMia, 'hey Noah look'))
    const message = await connection.send('u2', {
      text: 'hey @Noah **look**',
      mentions: ['u3'],
      replyTo: '10',
    })
    const request = fake.called('messages.sendMessage')[0]
    expect(request).toMatchObject({
      message: 'hey Noah look',
      replyTo: { _: 'inputReplyToMessage', replyToMsgId: 10 },
      entities: [
        {
          _: 'inputMessageEntityMentionName',
          offset: 4,
          length: 4,
          userId: { _: 'inputUser', userId: 3 },
        },
        { _: 'messageEntityBold', offset: 9, length: 4 },
      ],
    })
    expect(message).toMatchObject({ id: '11', conversation: 'u2', mine: true, delivery: 'sent' })
  })

  test('a message in a topic goes to that topic, a comment to the discussion group', async () => {
    const { fake, connection } = await linked()
    fake.answer('messages.sendMessage', sent(42, toForum))
    await connection.send('s50t7', { text: 'ok' })
    expect(fake.called('messages.sendMessage')[0]?.replyTo).toEqual({
      _: 'inputReplyToMessage',
      replyToMsgId: 7,
      topMsgId: 7,
    })
    fake.answer('messages.getDiscussionMessage', () => ({
      _: 'messages.discussionMessage',
      unreadCount: 0,
      chats: [TALK],
      users: [],
      messages: [text(800, { _: 'peerChannel', channelId: 61 }, 0, 'headline')],
    }))
    fake.answer('messages.sendMessage', sent(901, { _: 'peerChannel', channelId: 61 }))
    const comment = await connection.send('s60', { text: 'nice', thread: '50' })
    expect(fake.called('messages.sendMessage')[1]).toMatchObject({
      peer: { _: 'inputPeerChannel', channelId: 61 },
      replyTo: { replyToMsgId: 800, topMsgId: 800 },
    })
    expect(comment).toMatchObject({ id: 's61:901', conversation: 's60', thread: '50' })
  })

  test('a voice note recorded as webm goes out as Ogg with its wave, a photo as a photo', async () => {
    const { fake, connection } = await linked()
    fake.answer('messages.sendMedia', sent(12, toMia))
    const element = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body]
    const webm = new Uint8Array(
      element(
        [0x18, 0x53, 0x80, 0x67],
        [
          ...element(
            [0x16, 0x54, 0xae, 0x6b],
            element([0xae], element([0x86], [...new TextEncoder().encode('A_OPUS')])),
          ),
          ...element([0x1f, 0x43, 0xb6, 0x75], element([0xa3], [0x81, 0, 0, 0x80, 0xfc, 9])),
        ],
      ),
    )
    await connection.send('u2', {
      text: 'listen',
      attachments: [
        {
          name: 'note.weba',
          type: 'audio/webm',
          bytes: webm,
          kind: 'voice',
          seconds: 3.4,
          wave: [0, 128, 255],
        },
        { name: 'cat.png', type: 'image/png', bytes: new Uint8Array([1]) },
      ],
    })
    const [voice, picture] = fake.called('messages.sendMedia')
    expect(fake.uploads[0]).toMatchObject({ name: 'note.ogg', type: 'audio/ogg' })
    expect(new TextDecoder().decode(fake.uploads[0]?.bytes.subarray(0, 4))).toBe('OggS')
    expect(voice).toMatchObject({
      message: 'listen',
      media: {
        _: 'inputMediaUploadedDocument',
        mimeType: 'audio/ogg',
        attributes: [
          { _: 'documentAttributeAudio', voice: true, duration: 3 },
          { fileName: 'note.ogg' },
        ],
      },
    })
    expect(picture).toMatchObject({ message: '', media: { _: 'inputMediaUploadedPhoto' } })
  })

  test('a poll goes out, and a vote names the chosen options', async () => {
    const { fake, connection } = await linked()
    fake.answer('messages.sendMedia', (request: tl.messages.RawSendMediaRequest) => ({
      _: 'updates',
      updates: [
        {
          _: 'updateNewMessage',
          pts: 1,
          ptsCount: 1,
          message: text(13, toGroup, 1, '', {
            out: true,
            media: {
              _: 'messageMediaPoll',
              poll: {
                _: 'poll',
                id: Long.fromNumber(5),
                hash: Long.ZERO,
                question: { _: 'textWithEntities', text: 'When?', entities: [] },
                answers: ['Now', 'Later'].map((words, at) => ({
                  _: 'pollAnswer' as const,
                  text: { _: 'textWithEntities' as const, text: words, entities: [] },
                  option: new Uint8Array([at + 40]),
                })),
              },
              results: { _: 'pollResults' },
            },
          }),
        },
        { _: 'updateMessageID', id: 13, randomId: request.randomId },
      ],
      users: [],
      chats: [],
      date: 1,
      seq: 0,
    }))
    const poll = await connection.send('c40', {
      text: '',
      poll: { question: 'When?', answers: ['Now', 'Later'], several: false },
    })
    expect(fake.called('messages.sendMedia')[0]?.media).toMatchObject({
      _: 'inputMediaPoll',
      poll: {
        question: { text: 'When?' },
        answers: [{ _: 'inputPollAnswer', text: { text: 'Now' } }, { text: { text: 'Later' } }],
      },
    })
    expect(poll.poll).toMatchObject({ question: 'When?', answers: ['Now', 'Later'] })
    fake.answer('messages.sendVote', () => ({
      _: 'updates',
      updates: [],
      users: [],
      chats: [],
      date: 1,
      seq: 0,
    }))
    await connection.vote?.('c40', '13', [1])
    expect(fake.called('messages.sendVote')[0]?.options).toEqual([new Uint8Array([41])])
  })

  test('stickers and saved GIFs are listed and sent, GIFs found by @gif go through the bot', async () => {
    const { fake, connection } = await linked()
    const doc = (
      id: number,
      mimeType: string,
      attributes: tl.TypeDocumentAttribute[],
    ): tl.RawDocument => ({
      _: 'document',
      id: Long.fromNumber(id),
      accessHash: Long.ONE,
      fileReference: new Uint8Array([1]),
      date: 1,
      mimeType,
      size: 10,
      dcId: 1,
      attributes,
      thumbs: [{ _: 'photoSize', type: 'm', w: 128, h: 128, size: 4 }],
    })
    fake.answer('messages.getAllStickers', () => ({
      _: 'messages.allStickers',
      hash: Long.ZERO,
      sets: [
        {
          _: 'stickerSet',
          id: Long.fromNumber(3),
          accessHash: Long.ONE,
          title: 'Cats',
          shortName: 'cats',
          count: 1,
          hash: 0,
        },
      ],
    }))
    fake.answer('messages.getStickerSet', () => ({
      _: 'messages.stickerSet',
      set: {
        _: 'stickerSet',
        id: Long.fromNumber(3),
        accessHash: Long.ONE,
        title: 'Cats',
        shortName: 'cats',
        count: 1,
        hash: 0,
      },
      packs: [],
      keywords: [],
      documents: [
        doc(70, 'application/x-tgsticker', [
          { _: 'documentAttributeSticker', alt: '🐱', stickerset: { _: 'inputStickerSetEmpty' } },
        ]),
      ],
    }))
    const sets = await connection.stickers?.()
    expect(sets).toEqual([
      {
        id: '3',
        name: 'Cats',
        stickers: [expect.objectContaining({ ref: '70', emoji: '🐱', type: 'image/webp' })],
      },
    ])
    fake.files.set('70:m:\u0001', new Uint8Array([5]))
    expect(await connection.stickerBytes?.('70')).toEqual(new Uint8Array([5]))
    fake.answer('messages.sendMedia', sent(14, toMia))
    await connection.send('u2', { text: '', sticker: '70' })
    expect(fake.called('messages.sendMedia')[0]?.media).toMatchObject({
      _: 'inputMediaDocument',
      id: { _: 'inputDocument' },
    })

    fake.answer('messages.getSavedGifs', () => ({
      _: 'messages.savedGifs',
      hash: Long.ZERO,
      gifs: [doc(71, 'video/mp4', [{ _: 'documentAttributeAnimated' }])],
    }))
    expect((await connection.gifs?.(''))?.map((one) => one.ref)).toEqual(['71'])
    const bot = user(99, 'GIF', { username: 'gif', bot: true })
    fake.answer('contacts.resolveUsername', () => ({
      _: 'contacts.resolvedPeer',
      peer: { _: 'peerUser', userId: 99 },
      chats: [],
      users: [bot],
    }))
    fake.answer('messages.getInlineBotResults', () => ({
      _: 'messages.botResults',
      queryId: Long.fromNumber(123),
      cacheTime: 0,
      users: [bot],
      results: [
        {
          _: 'botInlineMediaResult',
          id: 'r1',
          type: 'gif',
          document: doc(72, 'video/mp4', [{ _: 'documentAttributeAnimated' }]),
          sendMessage: { _: 'botInlineMessageMediaAuto', message: '' },
        },
      ],
    }))
    expect((await connection.gifs?.('cats'))?.map((one) => one.ref)).toEqual(['72'])
    fake.answer('messages.sendInlineBotResult', sent(15, toMia))
    await connection.send('u2', { text: '', sticker: '72' })
    expect(fake.called('messages.sendInlineBotResult')[0]).toMatchObject({
      id: 'r1',
      queryId: Long.fromNumber(123),
    })
  })

  test('a reaction replaces the old one for an account without Premium', async () => {
    const { fake, connection } = await linked()
    fake.answer('messages.getHistory', () => ({
      _: 'messages.messages',
      topics: [],
      chats: [],
      users: [],
      messages: [
        text(10, toMia, 2, 'hi', {
          reactions: {
            _: 'messageReactions',
            results: [
              {
                _: 'reactionCount',
                reaction: { _: 'reactionEmoji', emoticon: '👍' },
                count: 1,
                chosenOrder: 0,
              },
            ],
          },
        }),
      ],
    }))
    await connection.history('u2', { limit: 1 })
    fake.answer('messages.sendReaction', () => ({
      _: 'updates',
      updates: [],
      users: [],
      chats: [],
      date: 1,
      seq: 0,
    }))
    await connection.react?.('u2', '10', '🔥', true)
    await connection.react?.('u2', '10', '👍', false)
    expect(fake.called('messages.sendReaction').map((one) => one.reaction)).toEqual([
      [{ _: 'reactionEmoji', emoticon: '🔥' }],
      [],
    ])
  })

  test('edit, pin, typing and removal, where groups only remove for everyone', async () => {
    const { fake, connection } = await linked()
    const nothing = () => ({ _: 'updates', updates: [], users: [], chats: [], date: 1, seq: 0 })
    for (const name of [
      'messages.editMessage',
      'messages.updatePinnedMessage',
      'messages.deleteMessages',
      'channels.deleteMessages',
    ])
      fake.answer(name, nothing)
    fake.answer('messages.setTyping', () => true)
    await connection.edit?.('u2', '10', { text: '_better_' })
    expect(fake.called('messages.editMessage')[0]).toMatchObject({
      id: 10,
      message: 'better',
      entities: [{ _: 'messageEntityItalic', offset: 0, length: 6 }],
    })
    await connection.pin?.('u2', '10', false)
    expect(fake.called('messages.updatePinnedMessage')[0]).toMatchObject({ id: 10, unpin: true })
    await connection.typing?.('s50t7', true)
    expect(fake.called('messages.setTyping')[0]).toMatchObject({
      action: { _: 'sendMessageTypingAction' },
      topMsgId: 7,
    })
    await connection.remove?.('u2', '10', false)
    await connection.remove?.('c40', '20', true)
    expect(fake.called('messages.deleteMessages')).toMatchObject([
      { id: [10] },
      { id: [20], revoke: true },
    ])
    await expect(connection.remove?.('s45', '30', false)).rejects.toThrow()
    await connection.remove?.('s45', '30', true)
    expect(fake.called('channels.deleteMessages')).toMatchObject([{ id: [30] }])
  })
})

describe('managing', () => {
  test('members with their roles and last seen', async () => {
    const { fake, connection } = await linked()
    fake.answer('channels.getParticipants', () => ({
      _: 'channels.channelParticipants',
      count: 3,
      chats: [],
      users: [fake.me, MIA, NOAH],
      participants: [
        { _: 'channelParticipantCreator', userId: 1, adminRights: { _: 'chatAdminRights' } },
        {
          _: 'channelParticipantAdmin',
          userId: 2,
          promotedBy: 1,
          date: 1,
          adminRights: { _: 'chatAdminRights' },
        },
        { _: 'channelParticipant', userId: 3, date: 1 },
      ],
    }))
    expect(await connection.members?.('s45')).toMatchObject([
      { id: 'u1', role: 'owner' },
      { id: 'u2', role: 'admin', online: false, lastSeen: 1_700_000_000_000 },
      { id: 'u3', role: 'member' },
    ])
    fake.answer('messages.getFullChat', () => ({
      _: 'messages.chatFull',
      chats: [GROUP],
      users: [MIA],
      fullChat: {
        _: 'chatFull',
        id: 40,
        about: '',
        notifySettings: { _: 'peerNotifySettings' },
        participants: {
          _: 'chatParticipants',
          chatId: 40,
          version: 1,
          participants: [{ _: 'chatParticipantCreator', userId: 2 }],
        },
      },
    }))
    expect(await connection.members?.('c40')).toMatchObject([{ id: 'u2', role: 'owner' }])
  })

  test('invite, kick, promote, rename, describe and leave use the group or supergroup call', async () => {
    const { fake, connection, heard } = await linked()
    const nothing = () => ({ _: 'updates', updates: [], users: [], chats: [], date: 1, seq: 0 })
    for (const name of [
      'messages.addChatUser',
      'channels.inviteToChannel',
      'messages.deleteChatUser',
      'channels.editBanned',
      'messages.editChatAdmin',
      'channels.editAdmin',
      'messages.editChatTitle',
      'channels.editTitle',
      'channels.leaveChannel',
    ])
      fake.answer(name, nothing)
    fake.answer('messages.editChatAbout', () => true)
    await connection.invite?.('c40', ['u2'])
    await connection.invite?.('s45', ['u2', 'u3'])
    await connection.kick?.('c40', 'u2')
    await connection.kick?.('s45', 'u3')
    await connection.promote?.('c40', 'u2', 'admin')
    await connection.promote?.('s45', 'u2', 'admin')
    await expect(connection.promote?.('s45', 'u2', 'owner')).rejects.toThrow()
    await connection.rename?.('s45', 'Crew')
    await connection.describe?.('s45', 'We ship')
    await connection.leave?.('s45')
    const names = fake.calls.map((one) => one._)
    expect(names.slice(names.lastIndexOf('messages.getForumTopics') + 1)).toEqual([
      'messages.addChatUser',
      'channels.inviteToChannel',
      'messages.deleteChatUser',
      'channels.editBanned',
      'messages.editChatAdmin',
      'channels.editAdmin',
      'channels.editTitle',
      'messages.editChatAbout',
      'channels.leaveChannel',
    ])
    expect(fake.called('channels.editBanned')[0]?.bannedRights).toMatchObject({
      viewMessages: true,
    })
    expect(fake.called('channels.editAdmin')[0]?.adminRights).toMatchObject({
      banUsers: true,
      manageTopics: true,
    })
    expect(heard).toContainEqual({
      t: 'conversation',
      conversation: expect.objectContaining({ id: 's45', title: 'Crew' }),
    })
    expect(heard).toContainEqual({ t: 'gone', conversation: 's45' })
  })

  test('mute, archive, pin to the top and mark unread', async () => {
    const { fake, connection, heard } = await linked()
    for (const name of [
      'account.updateNotifySettings',
      'messages.toggleDialogPin',
      'messages.markDialogUnread',
    ])
      fake.answer(name, () => true)
    fake.answer('folders.editPeerFolders', () => ({
      _: 'updates',
      updates: [],
      users: [],
      chats: [],
      date: 1,
      seq: 0,
    }))
    await connection.mute?.('u2', 1_900_000_000_000)
    await connection.mute?.('s50t7', null)
    await connection.archive?.('u2', true)
    await connection.pinConversation?.('c40', true)
    await connection.markUnread?.('u2')
    expect(
      fake.called('account.updateNotifySettings').map((one) => [one.peer._, one.settings]),
    ).toEqual([
      ['inputNotifyPeer', { _: 'inputPeerNotifySettings', muteUntil: 1_900_000_000 }],
      ['inputNotifyForumTopic', { _: 'inputPeerNotifySettings', muteUntil: 0 }],
    ])
    expect(fake.called('folders.editPeerFolders')[0]?.folderPeers[0]).toMatchObject({ folderId: 1 })
    expect(fake.called('messages.toggleDialogPin')[0]).toMatchObject({ pinned: true })
    expect(heard).toContainEqual({
      t: 'conversation',
      conversation: expect.objectContaining({ id: 'u2', archived: true }),
    })
  })

  test('people are found among contacts, a chat begins with one or a group with several', async () => {
    const { fake, connection } = await linked()
    fake.answer('contacts.search', () => ({
      _: 'contacts.found',
      myResults: [{ _: 'peerUser', userId: 2 }],
      results: [
        { _: 'peerUser', userId: 2 },
        { _: 'peerUser', userId: 3 },
      ],
      chats: [],
      users: [MIA, NOAH],
    }))
    expect((await connection.people?.('a'))?.map((one) => one.id)).toEqual(['u2', 'u3'])
    expect(await connection.begin?.(['u3'])).toMatchObject({ id: 'u3', kind: 'direct' })
    fake.answer('messages.createChat', () => ({
      _: 'messages.invitedUsers',
      missingInvitees: [],
      updates: {
        _: 'updates',
        updates: [],
        users: [],
        chats: [chat(41, 'Mia, Noah')],
        date: 1,
        seq: 0,
      },
    }))
    expect(await connection.begin?.(['u2', 'u3'])).toMatchObject({
      id: 'c41',
      kind: 'group',
      title: 'Mia, Noah',
    })
    expect(fake.called('messages.createChat')[0]?.title).toBe('Mia, Noah')
  })
})

describe('live', () => {
  test('new, changed and deleted messages, reads, reactions and pins', async () => {
    const { fake, connection, heard } = await linked()
    fake.answer('messages.getHistory', () => ({
      _: 'messages.messages',
      topics: [],
      chats: [],
      users: [],
      messages: [text(9, toMia, 1, 'mine', { out: true })],
    }))
    await connection.history('u2', { limit: 1 })
    fake.push({ _: 'updateNewMessage', message: text(11, toMia, 2, 'new'), pts: 1, ptsCount: 1 })
    fake.push({
      _: 'updateEditMessage',
      message: text(11, toMia, 2, 'newer', { editDate: 1_700_000_500 }),
      pts: 1,
      ptsCount: 1,
    })
    fake.push({ _: 'updateReadHistoryOutbox', peer: toMia, maxId: 9, pts: 1, ptsCount: 1 })
    fake.push({
      _: 'updateMessageReactions',
      peer: toMia,
      msgId: 9,
      reactions: {
        _: 'messageReactions',
        results: [
          { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '❤' }, count: 1 },
        ],
        recentReactions: [
          {
            _: 'messagePeerReaction',
            peerId: toMia,
            date: 1,
            reaction: { _: 'reactionEmoji', emoticon: '❤' },
          },
        ],
      },
    })
    fake.push({
      _: 'updatePinnedMessages',
      pinned: true,
      peer: toMia,
      messages: [9],
      pts: 1,
      ptsCount: 1,
    })
    fake.push({ _: 'updateDeleteMessages', messages: [11], pts: 1, ptsCount: 1 })
    fake.push({
      _: 'updateDeleteChannelMessages',
      channelId: 45,
      messages: [30],
      pts: 1,
      ptsCount: 1,
    })
    expect(heard).toMatchObject([
      { t: 'message', message: { id: '11', text: 'new' } },
      { t: 'changed', message: { id: '11', text: 'newer', editedAt: 1_700_000_500_000 } },
      { t: 'read', conversation: 'u2', person: 'u2', upTo: '9' },
      { t: 'changed', message: { id: '9', reactions: { '❤': ['u2'] }, delivery: 'read' } },
      { t: 'changed', message: { id: '9', pinned: true } },
      { t: 'deleted', conversation: 'u2', message: '11' },
      { t: 'deleted', conversation: 's45', message: '30' },
    ])
  })

  test('a message from a new chat brings the chat first', async () => {
    const { fake, heard } = await linked()
    fake.push(
      {
        _: 'updateNewMessage',
        message: text(1, { _: 'peerUser', userId: 8 }, 8, 'hello'),
        pts: 1,
        ptsCount: 1,
      },
      { users: [user(8, 'Lea')] },
    )
    expect(heard).toMatchObject([
      { t: 'conversation', conversation: { id: 'u8', title: 'Lea', kind: 'direct' } },
      { t: 'message', message: { conversation: 'u8', author: { name: 'Lea' } } },
    ])
  })

  test('typing ends by itself, presence follows the status, the connection state is passed on', async () => {
    vi.useFakeTimers()
    const { fake, heard } = await linked()
    fake.push({ _: 'updateUserTyping', userId: 2, action: { _: 'sendMessageTypingAction' } })
    fake.push({
      _: 'updateChannelUserTyping',
      channelId: 50,
      topMsgId: 7,
      fromId: { _: 'peerUser', userId: 3 },
      action: { _: 'sendMessageTypingAction' },
    })
    fake.push({ _: 'updateUserStatus', userId: 2, status: { _: 'userStatusOnline', expires: 1 } })
    fake.state('connecting')
    fake.state('online')
    vi.advanceTimersByTime(6000)
    expect(heard).toEqual([
      { t: 'typing', conversation: 'u2', person: 'u2', on: true },
      { t: 'typing', conversation: 's50t7', person: 'u3', on: true },
      { t: 'presence', person: 'u2', online: true },
      { t: 'status', status: 'connecting' },
      { t: 'status', status: 'online' },
      { t: 'typing', conversation: 'u2', person: 'u2', on: false },
      { t: 'typing', conversation: 's50t7', person: 'u3', on: false },
    ])
  })

  test('muting, archiving and reading elsewhere change the conversation', async () => {
    const { fake, heard } = await linked()
    fake.push({
      _: 'updateNotifySettings',
      peer: { _: 'notifyPeer', peer: toMia },
      notifySettings: { _: 'peerNotifySettings', muteUntil: 2_000_000_000 },
    })
    fake.push({
      _: 'updateFolderPeers',
      folderPeers: [{ _: 'folderPeer', peer: toGroup, folderId: 1 }],
      pts: 1,
      ptsCount: 1,
    })
    fake.push({
      _: 'updateReadHistoryInbox',
      peer: toMia,
      maxId: 10,
      stillUnreadCount: 0,
      pts: 1,
      ptsCount: 1,
    })
    expect(heard).toMatchObject([
      { t: 'conversation', conversation: { id: 'u2', mutedUntil: 2_000_000_000_000 } },
      { t: 'conversation', conversation: { id: 'c40', archived: true } },
      { t: 'conversation', conversation: { id: 'u2', unread: 0 } },
    ])
  })

  test('closing keeps the newest session and stops hearing', async () => {
    const { fake, host, connection, heard } = await linked()
    fake.sessionText = 'session-two'
    await connection.close()
    fake.push({ _: 'updateNewMessage', message: text(11, toMia, 2, 'late'), pts: 1, ptsCount: 1 })
    expect(heard).toEqual([])
    expect(host.secrets.get(secretName('telegram', '1', 'session'))).toBe('session-two')
    expect(fake.closed).toBe(true)
  })
})

describe('what our own calls change', () => {
  const reactionsOf = (emojis: readonly string[]): tl.TypeMessageReactions => ({
    _: 'messageReactions',
    results: emojis.map((emoticon, order) => ({
      _: 'reactionCount',
      reaction: { _: 'reactionEmoji', emoticon },
      count: 1,
      chosenOrder: order,
    })),
  })

  test('a second reaction keeps the first, since the answer to the first is applied', async () => {
    const fake = world()
    fake.me = user(1, 'Emil', { self: true, premium: true })
    const { connection } = await linked(fake)
    fake.answer('messages.getHistory', () => ({
      _: 'messages.messages',
      chats: [],
      users: [],
      messages: [text(10, toMia, 2, 'hi')],
    }))
    await connection.history('u2', { limit: 1 })
    fake.answer('messages.sendReaction', (request: tl.messages.RawSendReactionRequest) => ({
      _: 'updates',
      updates: [
        {
          _: 'updateMessageReactions',
          peer: toMia,
          msgId: request.msgId,
          reactions: reactionsOf(
            (request.reaction ?? []).flatMap((one) =>
              one._ === 'reactionEmoji' ? [one.emoticon] : [],
            ),
          ),
        },
      ],
      users: [],
      chats: [],
      date: 1,
      seq: 0,
    }))
    await connection.react?.('u2', '10', '👍', true)
    await connection.react?.('u2', '10', '🔥', true)
    expect(fake.called('messages.sendReaction').map((one) => one.reaction)).toEqual([
      [{ _: 'reactionEmoji', emoticon: '👍' }],
      [
        { _: 'reactionEmoji', emoticon: '👍' },
        { _: 'reactionEmoji', emoticon: '🔥' },
      ],
    ])
  })

  test('an edit is heard as soon as Telegram answers it', async () => {
    const { fake, connection, heard } = await linked()
    fake.answer('messages.editMessage', () => ({
      _: 'updates',
      updates: [
        {
          _: 'updateEditMessage',
          message: text(10, toMia, 1, 'better', { out: true, editDate: 1_700_000_900 }),
          pts: 2,
          ptsCount: 1,
        },
      ],
      users: [],
      chats: [],
      date: 1,
      seq: 0,
    }))
    await connection.edit?.('u2', '10', { text: 'better' })
    expect(heard).toMatchObject([
      { t: 'changed', message: { id: '10', text: 'better', editedAt: 1_700_000_900_000 } },
    ])
  })

  test('every file of a message with several shows up, and none goes out when one fails to upload', async () => {
    const { fake, connection, heard } = await linked()
    let next = 70
    fake.answer('messages.sendMedia', (request: { randomId: Long }) => sent(next++, toMia)(request))
    const file = (name: string) => ({
      name,
      type: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const first = await connection.send('u2', {
      text: 'two',
      attachments: [file('a.pdf'), file('b.pdf')],
    })
    expect(first.id).toBe('70')
    expect(heard.filter((one) => one.t === 'message').map((one) => one.message.id)).toEqual([
      '70',
      '71',
    ])
    const upload = fake.upload.bind(fake)
    let uploads = 0
    fake.upload = (bytes, name, type) =>
      ++uploads === 2 ? Promise.reject(failure('FILE_PARTS_INVALID')) : upload(bytes, name, type)
    const before = fake.called('messages.sendMedia').length
    await expect(
      connection.send('u2', { text: 'two', attachments: [file('c.pdf'), file('d.pdf')] }),
    ).rejects.toThrow()
    expect(fake.called('messages.sendMedia')).toHaveLength(before)
  })

  test('our comment in a discussion group we are not in brings no chat', async () => {
    const { fake, connection, heard } = await linked()
    fake.answer('messages.getDiscussionMessage', () => ({
      _: 'messages.discussionMessage',
      unreadCount: 0,
      chats: [TALK],
      users: [],
      messages: [text(800, { _: 'peerChannel', channelId: 61 }, 0, 'headline')],
    }))
    fake.answer('messages.sendMessage', sent(901, { _: 'peerChannel', channelId: 61 }))
    await connection.send('s60', { text: 'nice', thread: '50' })
    expect(heard.filter((one) => one.t === 'conversation')).toEqual([])
  })
})

describe('reading in forum topics', () => {
  test('a topic read elsewhere clears its count, and their reads of ours reach the topic', async () => {
    const { fake, heard } = await linked()
    fake.push({
      _: 'updateReadChannelDiscussionInbox',
      channelId: 50,
      topMsgId: 7,
      readMaxId: 40,
    })
    fake.push({
      _: 'updateReadChannelDiscussionOutbox',
      channelId: 50,
      topMsgId: 7,
      readMaxId: 40,
    })
    fake.push({ _: 'updateReadChannelOutbox', channelId: 50, maxId: 39 })
    expect(heard).toMatchObject([
      { t: 'conversation', conversation: { id: 's50t7', unread: 0 } },
      { t: 'read', conversation: 's50t7', upTo: '40' },
      { t: 'read', conversation: 's50t1', upTo: '39' },
    ])
  })

  test('a topic read only partly keeps the messages after the read mark unread', async () => {
    const { fake, connection, heard } = await linked()
    fake.answer('messages.getReplies', () => ({
      _: 'messages.messages',
      chats: [],
      users: [],
      messages: [41, 42, 43].map((id) =>
        text(id, toForum, 2, `m${id}`, {
          replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 7 },
        }),
      ),
    }))
    await connection.history('s50t7', { limit: 3 })
    fake.push({
      _: 'updateReadChannelDiscussionInbox',
      channelId: 50,
      topMsgId: 7,
      readMaxId: 42,
    })
    expect(heard).toMatchObject([{ t: 'conversation', conversation: { id: 's50t7', unread: 1 } }])
  })
})

describe('long messages', () => {
  test('a text over 4096 goes out in pieces, only the first one replying', async () => {
    const { fake, connection, heard } = await linked()
    let next = 80
    fake.answer('messages.sendMessage', (request: { randomId: Long }) =>
      sent(next++, toMia)(request),
    )
    const long = `${'word '.repeat(900)}\n\n${'more '.repeat(300)}`
    const first = await connection.send('u2', { text: long, replyTo: '10' })
    const calls = fake.called('messages.sendMessage')
    expect(calls).toHaveLength(2)
    for (const one of calls) expect(one.message.length).toBeLessThanOrEqual(4096)
    expect(calls[0]?.replyTo).toEqual({ _: 'inputReplyToMessage', replyToMsgId: 10 })
    expect(calls[1]?.replyTo).toBeUndefined()
    expect(first.id).toBe('80')
    expect(heard.filter((one) => one.t === 'message').map((one) => one.message.id)).toEqual([
      '80',
      '81',
    ])
  })

  test('in a topic every piece stays in the topic', async () => {
    const { fake, connection } = await linked()
    let next = 90
    fake.answer('messages.sendMessage', (request: { randomId: Long }) =>
      sent(next++, toForum)(request),
    )
    await connection.send('s50t7', { text: 'word '.repeat(1000) })
    expect(fake.called('messages.sendMessage').map((one) => one.replyTo)).toEqual([
      { _: 'inputReplyToMessage', replyToMsgId: 7, topMsgId: 7 },
      { _: 'inputReplyToMessage', replyToMsgId: 7, topMsgId: 7 },
    ])
  })

  test('a caption too long for a file goes out as text before the file', async () => {
    const { fake, connection } = await linked()
    let next = 95
    const answer = (request: { randomId: Long }) => sent(next++, toMia)(request)
    fake.answer('messages.sendMessage', answer)
    fake.answer('messages.sendMedia', answer)
    const caption = 'long '.repeat(300)
    await connection.send('u2', {
      text: caption,
      attachments: [{ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) }],
    })
    const texts = fake.called('messages.sendMessage')
    expect(texts).toHaveLength(1)
    expect(texts[0]?.message.length).toBeGreaterThan(1024)
    expect(fake.called('messages.sendMedia')[0]?.message).toBe('')
  })
})

describe('typing in a thread', () => {
  test('typing in a reply thread is sent to it and heard in it, never in the chat itself', async () => {
    vi.useFakeTimers()
    const { fake, connection, heard } = await linked()
    fake.answer('messages.setTyping', () => true)
    await connection.typing?.('s45', true, '30')
    await connection.typing?.('s60', true, '50')
    expect(fake.called('messages.setTyping')).toMatchObject([
      { peer: { _: 'inputPeerChannel', channelId: 45 }, topMsgId: 30 },
    ])
    fake.push({
      _: 'updateChannelUserTyping',
      channelId: 45,
      topMsgId: 30,
      fromId: { _: 'peerUser', userId: 2 },
      action: { _: 'sendMessageTypingAction' },
    })
    vi.advanceTimersByTime(6000)
    expect(heard).toEqual([
      { t: 'typing', conversation: 's45', person: 'u2', on: true, thread: '30' },
      { t: 'typing', conversation: 's45', person: 'u2', on: false, thread: '30' },
    ])
  })
})

describe('a new forum topic', () => {
  test('a message in a topic we do not know yet brings the topic with its own name', async () => {
    const { fake, heard } = await linked()
    fake.answer('messages.getForumTopicsByID', () => ({
      _: 'messages.forumTopics',
      count: 1,
      pts: 1,
      topics: [
        {
          _: 'forumTopic',
          id: 9,
          date: 1,
          peer: toForum,
          title: 'Trips',
          iconColor: 0,
          topMessage: 9,
          readInboxMaxId: 0,
          readOutboxMaxId: 0,
          unreadCount: 0,
          unreadMentionsCount: 0,
          unreadReactionsCount: 0,
          unreadPollVotesCount: 0,
          fromId: { _: 'peerUser', userId: 2 },
          notifySettings: { _: 'peerNotifySettings' },
        },
      ],
      messages: [],
      chats: [],
      users: [],
    }))
    fake.push({
      _: 'updateNewChannelMessage',
      message: text(60, toForum, 2, 'packing list', {
        replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 9 },
      }),
      pts: 1,
      ptsCount: 1,
    })
    await vi.waitFor(() =>
      expect(heard.filter((one) => one.t === 'conversation').at(-1)).toMatchObject({
        conversation: { id: 's50t9', title: 'Forum / Trips' },
      }),
    )
    expect(fake.called('messages.getForumTopicsByID')[0]).toMatchObject({ topics: [9] })
    expect(heard.flatMap((one) => (one.t === 'conversation' ? [one.conversation.id] : []))).toEqual(
      ['s50t9', 's50t9'],
    )
  })
})

describe('the General topic', () => {
  test('a page of General reads on past the other topics until it has messages', async () => {
    const { fake, connection } = await linked()
    const inTopic = (id: number) =>
      text(id, toForum, 2, `t${id}`, {
        replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 7 },
      })
    fake.answer('messages.getHistory', (request: tl.messages.RawGetHistoryRequest) => ({
      _: 'messages.messages',
      chats: [],
      users: [],
      messages:
        request.offsetId === 0
          ? [inTopic(100), inTopic(99)]
          : request.offsetId === 99
            ? [inTopic(98), text(97, toForum, 2, 'general')]
            : [text(96, toForum, 2, 'older general')],
    }))
    const page = await connection.history('s50t1', { limit: 2 })
    expect(page.messages.map((one) => one.text)).toEqual(['older general', 'general'])
    expect(page.before).toBeNull()
  })
})
