import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Connection, Host, ProviderEvent } from '../provider'
import { secretName } from '../provider'
import { Api, SlackError } from './api'
import { earlier, kindOfFile, live, slugOf } from './connection'
import { emoji, emojiIn, nameFor, textFor } from './emoji'
import { FakeSlack, fakeHost } from './fake'
import { CREATE_APP, MANIFEST, slackProvider, USER_EVENTS, USER_SCOPES } from './index'
import { markdownOf, mrkdwnOf } from './text'

const opened: Connection[] = []

afterEach(async () => {
  for (const one of opened.splice(0)) await one.close()
  live.clear()
})

function setup(
  options: ConstructorParameters<typeof FakeSlack>[0] = {},
  extra: Partial<Host> = {},
) {
  const slack = new FakeSlack(options)
  const waits: number[] = []
  const host = fakeHost(slack, extra)
  const provider = slackProvider({
    dial: slack.dial,
    wait: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
    poll: 1e9,
  })
  return { slack, host, provider, waits }
}

async function connect(
  given: ReturnType<typeof setup>,
  config: Record<string, string> = { token: 'xoxp-good' },
  account?: string,
) {
  const connection = await given.provider.connect(config, given.host, account)
  opened.push(connection)
  const events: ProviderEvent[] = []
  connection.start((event) => events.push(event))
  return { connection, events }
}

describe('mrkdwn and markdown', () => {
  const names: Record<string, string> = { U2: 'Mia', C1: 'general' }
  const nameOf = (id: string) => names[id]

  test('Slack text reads as markdown, with mentions named and entities undone', () => {
    const read = markdownOf(
      '*bold* _it_ ~gone~ <@U2> <#C1|general> <!here> <https://orden.so|site> <https://a.b?x=1&amp;y=2> 1 &lt; 2 &amp;&amp; `*code*`',
      nameOf,
    )
    expect(read.text).toBe(
      '**bold** _it_ ~~gone~~ @Mia #general @here [site](https://orden.so) https://a.b?x=1&y=2 1 < 2 && `*code*`',
    )
    expect(read.mentions).toEqual(['U2'])
    expect(read.everyone).toBe(true)
  })

  test('a code block keeps its contents and gets its own lines', () => {
    expect(markdownOf('see ```let *x* = 1```', nameOf).text).toBe('see ```\nlet *x* = 1\n```')
  })

  test('markdown is written as mrkdwn, mentions as Slack ids and the specials escaped', () => {
    const written = mrkdwnOf(
      '**bold** *it* ~~gone~~ [site](https://orden.so) @Mia and @here: 1 < 2 & `a<b`',
      [{ id: 'U2', name: 'Mia', handle: 'mia' }],
    )
    expect(written).toBe(
      '*bold* _it_ ~gone~ <https://orden.so|site> <@U2> and <!here>: 1 &lt; 2 &amp; `a&lt;b`',
    )
    expect(mrkdwnOf('mail@Mia.com', [{ id: 'U2', name: 'Mia' }])).toBe('mail@Mia.com')
  })

  test('underscores inside a word stay, and a link label keeps its bars', () => {
    expect(mrkdwnOf('foo__bar__baz and __init__')).toBe('foo__bar__baz and *init*')
    expect(markdownOf('<https://a.b|left | right>', nameOf).text).toBe(
      '[left | right](https://a.b)',
    )
  })

  test('a round trip keeps what was written', () => {
    const people = [{ id: 'U2', name: 'Mia' }]
    const markdown = '**hi** @Mia, _look_ at [this](https://orden.so) ~~now~~'
    expect(markdownOf(mrkdwnOf(markdown, people), nameOf).text).toBe(markdown)
  })
})

describe('emoji names', () => {
  test('Slack names become emoji and back, with skin tones and custom ones kept', async () => {
    const table = await emoji()
    expect(textFor(table, '+1')).toBe('👍')
    expect(textFor(table, 'thumbsup')).toBe('👍')
    expect(nameFor(table, '👍')).toBe('+1')
    expect(nameFor(table, '❤')).toBe('heart')
    expect(nameFor(table, '❤️')).toBe('heart')
    expect(textFor(table, 'wave::skin-tone-3')).toBe('👋🏼')
    expect(nameFor(table, '👋🏼')).toBe('wave::skin-tone-3')
    expect(textFor(table, 'black_n\u0069b')).toBe('✒️')
    expect(textFor(table, 'party_parrot')).toBe(':party_parrot:')
    expect(nameFor(table, ':party_parrot:')).toBe('party_parrot')
    expect(() => nameFor(table, 'abc')).toThrow('Slack does not know that emoji')
    expect(emojiIn(table, 'ship it :rocket: :party_parrot:')).toBe('ship it 🚀 :party_parrot:')
  })
})

describe('small helpers', () => {
  test('a timestamp just before, a channel name from a title, a file kind', () => {
    expect(earlier('1700000000.000100')).toBe('1700000000.000099')
    expect(earlier('1700000001.000000')).toBe('1700000000.999999')
    expect(slugOf('Café Plans 2027!')).toBe('cafe-plans-2027')
    expect(slugOf('Проект Альфа')).toBe('проект-альфа')
    expect(slugOf('営業チーム')).toBe('営業チーム')
    expect(slugOf('한국 팀')).toBe('한국-팀')
    expect(slugOf('हिन्दी टीम')).toBe('हिन्दी-टीम')
    expect(slugOf('😀'.repeat(3) + 'x'.repeat(100)).length).toBe(80)
    expect(() => slugOf('!!! 🎉')).toThrow('letter or a number')
    expect(kindOfFile({ mimetype: 'audio/mp4', subtype: 'slack_audio' })).toBe('voice')
    expect(kindOfFile({ mimetype: 'image/gif' })).toBe('gif')
    expect(kindOfFile({ mimetype: 'application/pdf' })).toBe('file')
  })
})

describe('rate limits', () => {
  test('a ratelimited answer waits as long as Retry-After says, then tries again', async () => {
    const slack = new FakeSlack({ limited: { 'auth.test': 2 } })
    const waits: number[] = []
    const api = new Api(fakeHost(slack), 'xoxp-good', (ms) => {
      waits.push(ms)
      return Promise.resolve()
    })
    const said = await api.call('auth.test')
    expect(said.user_id).toBe('U1')
    expect(waits).toEqual([7000, 7000])
  })

  test('it gives up after a few tries and says so', async () => {
    const slack = new FakeSlack({ limited: { 'auth.test': 10 } })
    const api = new Api(fakeHost(slack), 'xoxp-good', () => Promise.resolve())
    await expect(api.call('auth.test')).rejects.toThrow(SlackError)
  })
})

describe('a pasted token', () => {
  test('connects, lists every kind of conversation and keeps the token out of the account', async () => {
    const given = setup()
    const { connection } = await connect(given)
    expect(connection.account.id).toBe('T1-U1')
    expect(connection.account.self?.name).toBe('Emil')
    expect(JSON.stringify(connection.account)).not.toContain('xoxp')
    const list = await connection.conversations()
    const byId = Object.fromEntries(list.map((one) => [one.id, one]))
    expect(byId.C1).toMatchObject({ title: 'general', kind: 'group', role: 'member', members: 3 })
    expect(byId.D1).toMatchObject({ title: 'Mia', kind: 'direct', picture: 'U2' })
    expect(byId.G1?.title).toBe('Mia, Noah')
  })

  test('refuses a token of the wrong kind before asking Slack', async () => {
    const given = setup()
    await expect(given.provider.connect({ token: 'xoxb-bot' }, given.host)).rejects.toThrow('xoxp-')
    await expect(
      given.provider.connect({ token: 'xoxp-good', appToken: 'xoxb-1' }, given.host),
    ).rejects.toThrow('xapp-')
    expect(given.slack.calls).toHaveLength(0)
  })

  test('a revoked token signs out, says so, and is dropped from the vault', async () => {
    const given = setup()
    const name = secretName('slack', 'T1-U1', 'token')
    given.host.vault.set(name, 'xoxp-gone')
    await expect(given.provider.connect({}, given.host, 'T1-U1')).rejects.toThrow(
      'Signed out of Slack',
    )
    expect(given.host.vault.has(name)).toBe(false)
  })

  test('history reads mentions, threads, reactions, edits, pins and files', async () => {
    const given = setup()
    const { slack } = given
    const parent = slack.post('C1', 'U2', 'hey <@U1> :wave:', {
      reactions: [{ name: '+1', users: ['U1', 'U3'], count: 2 }],
      edited: { user: 'U2', ts: '1700000100.000000' },
      pinned_to: ['C1'],
      files: [
        { id: 'F9', name: 'a.png', mimetype: 'image/png', size: 3, original_w: 4, original_h: 2 },
      ],
    })
    slack.post('C1', 'U3', 'reply', { thread_ts: parent.ts })
    Object.assign(parent, {
      thread_ts: parent.ts,
      reply_count: 1,
      latest_reply: '1700000200.000000',
    })
    slack.post('C1', 'U1', '<!channel> joined', { subtype: 'channel_join' })
    const { connection } = await connect(given)
    const page = await connection.history('C1', { limit: 50 })
    expect(page.before).toBeNull()
    const [first, second] = page.messages
    expect(page.messages).toHaveLength(2)
    expect(first).toMatchObject({
      text: 'hey @Emil 👋',
      mentions: ['U1'],
      replies: 1,
      lastReplyAt: 1700000200000,
      reactions: { '👍': ['U1', 'U3'] },
      editedAt: 1700000100000,
      pinned: true,
      mine: false,
      author: { id: 'U2', name: 'Mia' },
    })
    expect(first?.attachments[0]).toMatchObject({ ref: 'F9', kind: 'image', width: 4, height: 2 })
    expect(second).toMatchObject({ system: true, mine: true, mentions: ['U1'] })
    const thread = await connection.thread?.('C1', parent.ts as string, { limit: 10 })
    expect(thread?.messages.map((one) => [one.text, one.thread])).toEqual([['reply', parent.ts]])
  })

  test('history pages back and opens around a message', async () => {
    const given = setup()
    const sent = Array.from({ length: 7 }, (_, at) => given.slack.post('C1', 'U2', `m${at}`))
    const { connection } = await connect(given)
    const newest = await connection.history('C1', { limit: 3 })
    expect(newest.messages.map((one) => one.text)).toEqual(['m4', 'm5', 'm6'])
    const older = await connection.history('C1', { limit: 3, before: newest.before ?? '' })
    expect(older.messages.map((one) => one.text)).toEqual(['m1', 'm2', 'm3'])
    const around = await connection.history('C1', { limit: 4, around: sent[3]?.ts as string })
    expect(around.messages.map((one) => one.text)).toEqual(['m2', 'm3', 'm4', 'm5'])
  })

  test('sends, replies in a thread and to the channel too, edits and deletes for everyone', async () => {
    const given = setup()
    const { connection } = await connect(given)
    const sent = await connection.send('C1', {
      text: '**hi** @Mia @here',
      mentions: ['U2'],
    })
    expect(given.slack.calls.at(-1)?.form.get('text')).toBe('*hi* <@U2> <!here>')
    expect(sent).toMatchObject({ text: '**hi** @Mia @here', mine: true, conversation: 'C1' })
    const reply = await connection.send('C1', {
      text: 'in thread',
      thread: sent.id,
      broadcast: true,
    })
    expect(reply.thread).toBe(sent.id)
    expect(given.slack.calls.at(-1)?.form.get('reply_broadcast')).toBe('true')
    await connection.edit?.('C1', sent.id, { text: 'changed' })
    expect((await connection.history('C1', { limit: 5 })).messages[0]?.editedAt).toBeDefined()
    await expect(connection.remove?.('C1', sent.id, false)).rejects.toThrow('for everyone')
    await connection.remove?.('C1', sent.id, true)
    expect(
      (await connection.history('C1', { limit: 5 })).messages.map((one) => one.id),
    ).not.toContain(sent.id)
  })

  test('reacts by emoji, pins and marks read and unread', async () => {
    const given = setup()
    const message = given.slack.post('C1', 'U2', 'hello')
    given.slack.post('C1', 'U2', 'again')
    const { connection } = await connect(given)
    const ts = message.ts as string
    await connection.react?.('C1', ts, '🎉', true)
    await connection.react?.('C1', ts, '🎉', true)
    expect(
      given.slack.calls
        .filter((one) => one.method === 'reactions.add')
        .at(-1)
        ?.form.get('name'),
    ).toBe('tada')
    await connection.react?.('C1', ts, ':party_parrot:', true)
    let shown = (await connection.history('C1', { limit: 5 })).messages[0]
    expect(shown?.reactions).toEqual({ '🎉': ['U1'], ':party_parrot:': ['U1'] })
    await connection.react?.('C1', ts, '🎉', false)
    await connection.pin?.('C1', ts, true)
    shown = (await connection.history('C1', { limit: 5 })).messages[0]
    expect(shown?.pinned).toBe(true)
    expect(Object.keys(shown?.reactions ?? {})).toEqual([':party_parrot:'])
    await connection.markRead?.('C1', ts)
    expect(given.slack.channels.get('C1')?.last_read).toBe(ts)
    await connection.markUnread?.('C1')
    expect(given.slack.channels.get('C1')?.last_read).toBe(
      earlier(given.slack.channels.get('C1')?.messages.at(-1)?.ts as string),
    )
  })

  test('searches, lists members and people, and starts conversations', async () => {
    const given = setup()
    given.slack.post('C1', 'U2', 'the launch plan')
    given.slack.post('D1', 'U2', 'launch soon?')
    const { connection, events } = await connect(given)
    await connection.conversations()
    expect((await connection.search?.('launch'))?.map((one) => one.conversation).sort()).toEqual([
      'C1',
      'D1',
    ])
    expect((await connection.search?.('launch', 'C1'))?.map((one) => one.text)).toEqual([
      'the launch plan',
    ])
    const members = await connection.members?.('C1')
    expect(members?.find((one) => one.id === 'U2')?.role).toBe('owner')
    expect((await connection.people?.('noa'))?.map((one) => one.name)).toEqual(['Noah'])
    const direct = await connection.begin?.(['U3'])
    expect(direct).toMatchObject({ kind: 'direct', title: 'Noah' })
    const group = await connection.begin?.(['U2', 'U3'], 'Trip Plans')
    expect(group).toMatchObject({ title: 'trip-plans', role: 'owner' })
    expect(given.slack.channels.get(group?.id ?? '')?.members).toEqual(['U1', 'U2', 'U3'])
    const told = events.flatMap((one) => (one.t === 'conversation' ? [one.conversation.id] : []))
    expect(told).toEqual(expect.arrayContaining([direct?.id, group?.id]))
  })

  test('invites, removes, renames, describes and leaves a channel', async () => {
    const given = setup()
    const { connection, events } = await connect(given)
    await connection.conversations()
    await connection.kick?.('C1', 'U3')
    expect(given.slack.channels.get('C1')?.members).toEqual(['U1', 'U2'])
    await connection.invite?.('C1', ['U3'])
    expect(given.slack.channels.get('C1')?.members).toContain('U3')
    await connection.rename?.('C1', 'Main Room')
    expect(given.slack.channels.get('C1')?.name).toBe('main-room')
    await connection.describe?.('C1', 'Everything')
    expect(given.slack.channels.get('C1')?.topic?.value).toBe('Everything')
    await connection.leave?.('C1')
    expect(given.slack.channels.get('C1')?.members).not.toContain('U1')
    expect(events).toContainEqual({ t: 'gone', conversation: 'C1' })
  })

  test('uploads a file into a thread and reads it back with the token', async () => {
    const given = setup()
    const parent = given.slack.post('C1', 'U2', 'send it')
    const { connection } = await connect(given)
    const sent = await connection.send('C1', {
      text: 'here',
      thread: parent.ts as string,
      attachments: [{ name: 'a.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
    })
    expect(sent).toMatchObject({ text: 'here', thread: parent.ts })
    expect(sent.id).toBe(given.slack.channels.get('C1')?.messages.at(-1)?.ts)
    expect(given.waits).toEqual([])
    expect(sent.attachments[0]).toMatchObject({ name: 'a.png', kind: 'image', size: 3 })
    const bytes = await connection.attachment('C1', sent.id, sent.attachments[0]?.ref ?? '')
    expect([...bytes]).toEqual([1, 2, 3])
  })

  test('files need the native request, since files.slack.com refuses the web view', async () => {
    const given = setup()
    delete given.host.request
    const { connection } = await connect(given)
    await expect(
      connection.send('C1', {
        text: '',
        attachments: [{ name: 'a.png', type: 'image/png', bytes: new Uint8Array([1]) }],
      }),
    ).rejects.toThrow('desktop app')
  })

  test('a picture comes from the profile', async () => {
    const given = setup()
    const { connection } = await connect(given)
    await connection.conversations()
    const bytes = await connection.picture?.('D1')
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toContain('U2_72')
  })

  test('disconnecting revokes the token', async () => {
    const given = setup()
    await connect(given)
    await given.provider.forget?.('T1-U1', given.host)
    expect(given.slack.revoked).toEqual(['xoxp-good'])
  })
})

describe('without Socket Mode', () => {
  test('a watched conversation is polled for new, changed and deleted messages', async () => {
    const given = setup()
    const old = given.slack.post('C1', 'U2', 'old')
    const gone = given.slack.post('C1', 'U2', 'gone soon')
    const { connection, events } = await connect(given)
    expect(events).toEqual([{ t: 'status', status: 'online' }])
    await connection.conversations()
    await connection.history('C1', { limit: 20 })
    given.slack.post('C1', 'U3', 'new one')
    old.text = 'old, edited'
    old.edited = { ts: given.slack.ts() }
    const channel = given.slack.channels.get('C1')
    if (channel) channel.messages = channel.messages.filter((one) => one !== gone)
    const polling = connection as unknown as { tick(): Promise<void> }
    await polling.tick()
    const kinds = events
      .slice(1)
      .map((one) =>
        one.t === 'message' || one.t === 'changed'
          ? [one.t, one.message.text]
          : one.t === 'deleted'
            ? [one.t, one.message]
            : [one.t],
      )
    expect(kinds).toContainEqual(['message', 'new one'])
    expect(kinds).toContainEqual(['changed', 'old, edited'])
    expect(kinds).toContainEqual(['deleted', gone.ts])
    expect(kinds).toContainEqual(['presence'])
  })
})

describe('polling an empty conversation', () => {
  test('the first message and the removal of the last one are both heard', async () => {
    const given = setup()
    const { connection, events } = await connect(given)
    await connection.history('D1', { limit: 20 })
    const first = given.slack.post('D1', 'U2', 'first ever')
    const tick = () => (connection as unknown as { tick(): Promise<void> }).tick()
    await tick()
    expect(events).toContainEqual(
      expect.objectContaining({
        t: 'message',
        message: expect.objectContaining({ text: 'first ever' }),
      }),
    )
    const channel = given.slack.channels.get('D1')
    if (channel) channel.messages = []
    await tick()
    expect(events).toContainEqual({ t: 'deleted', conversation: 'D1', message: first.ts })
  })
})

describe('Socket Mode', () => {
  test('connects with the app-level token, acknowledges events and hears them live', async () => {
    const given = setup()
    const message = given.slack.post('C1', 'U2', 'hi')
    const { connection, events } = await connect(given, {
      token: 'xoxp-good',
      appToken: 'xapp-good',
    })
    await connection.conversations()
    await connection.history('C1', { limit: 5 })
    await vi.waitFor(() =>
      expect(events.some((one) => one.t === 'status' && one.status === 'online')).toBe(true),
    )
    expect(events.some((one) => one.t === 'status' && one.status === 'online')).toBe(true)
    const opener = given.slack.calls.find((one) => one.method === 'apps.connections.open')
    expect(opener?.form.get('token')).toBe('xapp-good')
    given.slack.event({
      type: 'message',
      channel: 'C1',
      user: 'U2',
      text: 'live <@U1>',
      ts: given.slack.ts(),
    })
    given.slack.event({
      type: 'reaction_added',
      user: 'U3',
      reaction: 'fire',
      item: { type: 'message', channel: 'C1', ts: message.ts },
    })
    given.slack.event({
      type: 'message',
      subtype: 'message_deleted',
      channel: 'C1',
      deleted_ts: message.ts,
    })
    await vi.waitFor(() => expect(given.slack.lines.at(-1)?.sent).toHaveLength(3))
    await vi.waitFor(() =>
      expect(
        events.filter((one) => ['message', 'changed', 'deleted'].includes(one.t)),
      ).toHaveLength(3),
    )
    const heard = (t: ProviderEvent['t']) => events.find((one) => one.t === t)
    expect(heard('message')).toMatchObject({ message: { text: 'live @Emil', mentions: ['U1'] } })
    expect(heard('changed')).toMatchObject({ message: { reactions: { '🔥': ['U3'] } } })
    expect(heard('deleted')).toEqual({ t: 'deleted', conversation: 'C1', message: message.ts })
  })

  test('a disconnect asks for a new link and goes on', async () => {
    const given = setup()
    await connect(given, { token: 'xoxp-good', appToken: 'xapp-good' })
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(1))
    given.slack.lines.at(-1)?.say({ type: 'disconnect', reason: 'refresh_requested' })
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(2))
    expect(given.slack.lines[0]?.open).toBe(false)
  })
})

describe('threads', () => {
  test('a reply also sent to the channel shows in the channel and in its thread', async () => {
    const given = setup()
    const parent = given.slack.post('C1', 'U2', 'question')
    given.slack.post('C1', 'U3', 'quiet reply', { thread_ts: parent.ts })
    const loud = given.slack.post('C1', 'U3', 'loud reply', {
      thread_ts: parent.ts,
      subtype: 'thread_broadcast',
    })
    const { connection } = await connect(given)
    const channel = await connection.history('C1', { limit: 20 })
    const shown = channel.messages.find((one) => one.id === loud.ts)
    expect(shown?.thread).toBeUndefined()
    expect(shown?.replyTo).toBe(parent.ts)
    expect(channel.messages.map((one) => one.text)).not.toContain('quiet reply')
    const thread = await connection.thread?.('C1', parent.ts as string, { limit: 20 })
    expect(thread?.messages.map((one) => [one.text, one.thread])).toEqual([
      ['quiet reply', parent.ts],
      ['loud reply', parent.ts],
    ])
  })

  test('a live reply also sent to the channel reaches the channel and the thread', async () => {
    const given = setup()
    const parent = given.slack.post('C1', 'U2', 'question')
    const { connection, events } = await connect(given, {
      token: 'xoxp-good',
      appToken: 'xapp-good',
    })
    await connection.history('C1', { limit: 20 })
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(1))
    const loud = given.slack.post('C1', 'U3', 'loud', {
      thread_ts: parent.ts,
      subtype: 'thread_broadcast',
    })
    given.slack.event({ ...loud, channel: 'C1' })
    await vi.waitFor(() =>
      expect(events.filter((one) => one.t === 'message').map((one) => one.message)).toEqual([
        expect.objectContaining({ id: loud.ts, thread: parent.ts }),
        expect.objectContaining({ id: loud.ts, replyTo: parent.ts }),
      ]),
    )
    const inChannel = events.filter((one) => one.t === 'message')[1]
    expect(inChannel?.t === 'message' && inChannel.message.thread).toBeUndefined()
  })

  test('a live reply updates its parent, and a replied notice is no message of its own', async () => {
    const given = setup()
    const parent = given.slack.post('C1', 'U2', 'question')
    const { connection, events } = await connect(given, {
      token: 'xoxp-good',
      appToken: 'xapp-good',
    })
    await connection.history('C1', { limit: 20 })
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(1))
    const reply = given.slack.post('C1', 'U3', 'answer', { thread_ts: parent.ts })
    parent.thread_ts = parent.ts
    parent.reply_count = 1
    parent.latest_reply = reply.ts
    given.slack.event({
      type: 'message',
      channel: 'C1',
      hidden: true,
      ts: given.slack.ts(),
      message: { ...parent },
    })
    given.slack.event({ ...reply, channel: 'C1' })
    await vi.waitFor(() =>
      expect(
        events.filter((one) => one.t === 'changed' && one.message.id === parent.ts).length,
      ).toBeGreaterThanOrEqual(2),
    )
    const messages = events.flatMap((one) => (one.t === 'message' ? [one.message] : []))
    expect(messages.map((one) => one.text)).toEqual(['answer'])
    const last = events.filter((one) => one.t === 'changed').at(-1)
    expect(last?.t === 'changed' && last.message.replies).toBe(1)
  })

  test('without Socket Mode an open thread is polled for new, edited and removed replies', async () => {
    const given = setup()
    const parent = given.slack.post('C1', 'U2', 'question')
    const first = given.slack.post('C1', 'U3', 'first', { thread_ts: parent.ts })
    const gone = given.slack.post('C1', 'U3', 'gone', { thread_ts: parent.ts })
    const { connection, events } = await connect(given)
    await connection.history('C1', { limit: 20 })
    await connection.thread?.('C1', parent.ts as string, { limit: 20 })
    await connection.history('C1', { limit: 20 })
    given.slack.post('C1', 'U2', 'second', { thread_ts: parent.ts })
    first.text = 'first, edited'
    first.edited = { ts: given.slack.ts() }
    const channel = given.slack.channels.get('C1')
    if (channel) channel.messages = channel.messages.filter((one) => one !== gone)
    await (connection as unknown as { tick(): Promise<void> }).tick()
    const seen = events.flatMap((one) =>
      one.t === 'message' || one.t === 'changed'
        ? [[one.t, one.message.text, one.message.thread]]
        : one.t === 'deleted'
          ? [[one.t, one.message]]
          : [],
    )
    expect(seen).toContainEqual(['message', 'second', parent.ts])
    expect(seen).toContainEqual(['changed', 'first, edited', parent.ts])
    expect(seen).toContainEqual(['deleted', gone.ts])
  })
})

describe('workspace-wide channel events', () => {
  test('a channel you are not in stays out of the list when it is made, renamed or archived', async () => {
    const given = setup()
    given.slack.channel({
      id: 'C8',
      name: 'elsewhere',
      creator: 'U2',
      members: ['U2'],
      messages: [],
    })
    const { connection, events } = await connect(given, {
      token: 'xoxp-good',
      appToken: 'xapp-good',
    })
    await connection.conversations()
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(1))
    given.slack.event({
      type: 'channel_created',
      channel: { id: 'C9', name: 'random', created: 1, creator: 'U2' },
    })
    given.slack.event({
      type: 'channel_rename',
      channel: { id: 'C8', name: 'renamed', created: 1 },
    })
    given.slack.event({ type: 'channel_archive', channel: 'C8', user: 'U2' })
    given.slack.event({ type: 'channel_unarchive', channel: 'C8', user: 'U2' })
    given.slack.event({
      type: 'channel_created',
      channel: { id: 'C7', name: 'mine', created: 1, creator: 'U1' },
    })
    given.slack.event({
      type: 'channel_rename',
      channel: { id: 'C1', name: 'everyone', created: 1 },
    })
    await vi.waitFor(() =>
      expect(
        events.some((one) => one.t === 'conversation' && one.conversation.title === 'everyone'),
      ).toBe(true),
    )
    await new Promise((done) => setTimeout(done, 30))
    const shown = events.flatMap((one) => (one.t === 'conversation' ? [one.conversation.id] : []))
    expect(shown).toContain('C7')
    expect(shown).not.toContain('C8')
    expect(shown).not.toContain('C9')
  })
})

describe('when Socket Mode cannot carry the messages', () => {
  const texts = (events: ProviderEvent[]) =>
    events.flatMap((one) => (one.t === 'message' ? [one.message.text] : []))
  const polling = (connection: Connection) => connection as unknown as { tick(): Promise<void> }
  const onlines = (events: ProviderEvent[]) =>
    events.filter((one) => one.t === 'status' && one.status === 'online').length

  test('a socket that never comes up leaves the open conversations polled', async () => {
    const given = setup()
    const silent = slackProvider({
      dial: () => ({ send: () => undefined, close: () => undefined }),
      wait: () => Promise.resolve(),
      poll: 1e9,
    })
    given.slack.post('C1', 'U2', 'before')
    const connection = await silent.connect(
      { token: 'xoxp-good', appToken: 'xapp-good' },
      given.host,
    )
    opened.push(connection)
    const events: ProviderEvent[] = []
    connection.start((event) => events.push(event))
    await connection.conversations()
    await connection.history('C1', { limit: 20 })
    given.slack.post('C1', 'U3', 'while the socket is down')
    await polling(connection).tick()
    expect(texts(events)).toContain('while the socket is down')
  })

  test('a revoked app-level token stops the socket and the conversations are polled', async () => {
    const given = setup()
    const { connection, events } = await connect(given, {
      token: 'xoxp-good',
      appToken: 'xapp-good',
    })
    await connection.conversations()
    await connection.history('C1', { limit: 20 })
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(1))
    given.slack.appTokens.clear()
    given.slack.lines.at(-1)?.say({ type: 'disconnect', reason: 'refresh_requested' })
    await vi.waitFor(() => expect(onlines(events)).toBe(2))
    const opens = given.slack.calls.filter((one) => one.method === 'apps.connections.open').length
    given.slack.post('C1', 'U3', 'polled instead')
    await polling(connection).tick()
    expect(texts(events)).toContain('polled instead')
    expect(given.slack.calls.filter((one) => one.method === 'apps.connections.open')).toHaveLength(
      opens,
    )
  })

  test('Socket Mode turned off in the app stops the socket instead of dialing forever', async () => {
    const given = setup()
    const { connection, events } = await connect(given, {
      token: 'xoxp-good',
      appToken: 'xapp-good',
    })
    await connection.history('C1', { limit: 20 })
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(1))
    given.slack.lines.at(-1)?.say({ type: 'disconnect', reason: 'link_disabled' })
    await vi.waitFor(() => expect(onlines(events)).toBe(2))
    expect(given.slack.lines).toHaveLength(1)
    given.slack.post('C1', 'U2', 'heard by polling')
    await polling(connection).tick()
    expect(texts(events)).toContain('heard by polling')
  })

  test('what was said while the socket was away arrives once it is back', async () => {
    const given = setup()
    const { connection, events } = await connect(given, {
      token: 'xoxp-good',
      appToken: 'xapp-good',
    })
    await connection.conversations()
    await connection.history('C1', { limit: 20 })
    await vi.waitFor(() => expect(given.slack.lines).toHaveLength(1))
    await vi.waitFor(() => expect(onlines(events)).toBe(1))
    given.slack.lines.at(-1)?.close()
    given.slack.post('C1', 'U3', 'said in the gap')
    await vi.waitFor(() => expect(texts(events)).toContain('said in the gap'))
    given.slack.event({ ...given.slack.post('C1', 'U2', 'live again'), channel: 'C1' })
    await vi.waitFor(() => expect(texts(events)).toContain('live again'))
    const listed = () => given.slack.calls.filter((one) => one.method === 'users.conversations')
    const before = listed().length
    given.slack.lines.at(-1)?.close()
    await vi.waitFor(() => expect(listed().length).toBeGreaterThan(before))
    expect(texts(events).filter((one) => one === 'live again')).toHaveLength(1)
    expect(events.some((one) => one.t === 'deleted')).toBe(false)
  })

  test('an app-level token Slack refuses is said at once, not found out later', async () => {
    const given = setup()
    await expect(
      given.provider.connect({ token: 'xoxp-good', appToken: 'xapp-wrong' }, given.host),
    ).rejects.toThrow('app-level token')
  })
})

describe('your own Slack app', () => {
  test('Orden signs in to no app of its own: the token is pasted or nothing connects', async () => {
    const given = setup()
    await expect(given.provider.connect({}, given.host)).rejects.toThrow('xoxp-')
    expect(given.slack.calls).toHaveLength(0)
    const token = given.provider.fields.find((one) => one.key === 'token')
    expect(token).toMatchObject({ secret: true })
    expect(token?.optional).toBeUndefined()
  })

  test('the one-click link creates an app with every user scope, Socket Mode and the user events', () => {
    const url = new URL(CREATE_APP)
    expect(url.origin + url.pathname).toBe('https://api.slack.com/apps')
    expect(url.searchParams.get('new_app')).toBe('1')
    const manifest = JSON.parse(url.searchParams.get('manifest_json') ?? '') as typeof MANIFEST
    expect(manifest).toEqual(MANIFEST)
    expect(manifest.oauth_config.scopes.user).toEqual([...USER_SCOPES])
    expect(manifest.oauth_config.scopes).not.toHaveProperty('bot')
    expect(manifest.settings.socket_mode_enabled).toBe(true)
    expect(manifest.settings.event_subscriptions.user_events).toEqual([...USER_EVENTS])
    expect(CREATE_APP.length).toBeLessThan(4000)
  })

  test('every event the app subscribes to is one the connection hears', async () => {
    const given = setup()
    const { connection } = await connect(given)
    const heard = Object.keys((connection as unknown as { handlers: object }).handlers)
    const asked = new Set(USER_EVENTS.map((one) => one.replace(/\..*$/, '')))
    expect([...asked].filter((one) => !heard.includes(one))).toEqual([])
  })

  test('every scope a call needs is one the app asks for', () => {
    const needs = ['search:read', 'files:write', 'pins:write', 'reactions:write', 'emoji:read']
    for (const one of needs) expect(USER_SCOPES).toContain(one)
  })
})
