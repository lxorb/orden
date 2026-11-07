import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Host, ProviderEvent, Screen, Stream } from '../provider'
import { FakeSignalCli } from './fake'
import { signalProvider } from './index'
import { ascii, Rpc } from './rpc'
import { keptFor, memoryStore } from './store'
import { markdownOf, PLACE, stylesOf, withMentions } from './text'

const ME = '11111111-1111-4111-8111-111111111111'
const ANA = '22222222-2222-4222-8222-222222222222'
const BEN = '33333333-3333-4333-8333-333333333333'
const GROUP = 'Z3JvdXAtb25lLWlkLWJhc2U2NA=='

class TestHost implements Host {
  readonly secrets = new Map<string, string>()
  readonly bigs = new Map<string, Uint8Array>()
  readonly shown: (Screen | null)[] = []
  clock = 1_800_000_000_000
  fetch = (() => Promise.reject(new Error('no network'))) as unknown as typeof fetch

  constructor(readonly cli: FakeSignalCli) {}

  now(): number {
    return this.clock
  }

  secret(name: string): Promise<string | null> {
    return Promise.resolve(this.secrets.get(name) ?? null)
  }

  keepSecret(name: string, value: string | null): Promise<void> {
    if (value === null) this.secrets.delete(name)
    else this.secrets.set(name, value)
    return Promise.resolve()
  }

  show = (screen: Screen | null): void => {
    this.shown.push(screen)
  }

  sealed = {
    read: (name: string) => Promise.resolve(this.bigs.get(name) ?? null),
    write: (name: string, bytes: Uint8Array | null) => {
      if (bytes === null) this.bigs.delete(name)
      else this.bigs.set(name, bytes)
      return Promise.resolve()
    },
  }

  sidecar = (program: string, args: readonly string[]): Promise<Stream> => {
    expect(program).toBe('signal-cli')
    expect(args).toEqual(['jsonRpc', '--receive-mode=manual', '--ignore-stories'])
    return Promise.resolve(this.cli.program())
  }
}

function settle(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0))
}

async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !check(); tries++) await settle()
  expect(check()).toBe(true)
}

function linked(): FakeSignalCli {
  const cli = new FakeSignalCli()
  cli.accounts = [{ number: '+41790000001', aci: ME }]
  cli.contacts = [
    { uuid: ANA, number: '+41790000002', name: 'Ana Muster' },
    { uuid: BEN, number: '+41790000003', name: 'Ben' },
  ]
  cli.groups = [
    {
      id: GROUP,
      name: 'Climbing',
      description: 'Tuesdays',
      members: [{ uuid: ME, isAdmin: true }, { uuid: ANA }, { uuid: BEN }],
    },
  ]
  return cli
}

const opened: Connection[] = []

async function connected(
  cli = linked(),
  store = memoryStore(),
  host = new TestHost(cli),
): Promise<{
  cli: FakeSignalCli
  host: TestHost
  store: ReturnType<typeof memoryStore>
  connection: Connection
  heard: ProviderEvent[]
}> {
  const provider = signalProvider({ store: () => store })
  const connection = await provider.connect({}, host, ME)
  opened.push(connection)
  const heard: ProviderEvent[] = []
  connection.start((event) => heard.push(event))
  return { cli, host, store, connection, heard }
}

function incoming(cli: FakeSignalCli, envelope: Record<string, unknown>): void {
  cli.deliver('+41790000001', {
    source: ANA,
    sourceUuid: ANA,
    sourceNumber: '+41790000002',
    sourceName: 'Ana Muster',
    sourceDevice: 1,
    ...envelope,
  })
}

function lastCall(cli: FakeSignalCli, method: string): Record<string, unknown> {
  const found = cli.calls.filter((one) => one.method === method).at(-1)
  expect(found, method).toBeDefined()
  return found?.params ?? {}
}

afterEach(async () => {
  for (const one of opened.splice(0)) await one.close()
  vi.useRealTimers()
})

describe('signal text', () => {
  it('reads styles and mentions as markdown and writes markdown back as styles', () => {
    const text = `Hi ${PLACE}, this is bold and code`
    const markdown = markdownOf(
      text,
      [
        { start: 14, length: 4, style: 'BOLD' },
        { start: 23, length: 4, style: 'MONOSPACE' },
      ],
      [{ start: 3, length: 1, uuid: ANA }],
      () => 'Ana',
    )
    expect(markdown).toBe('Hi @Ana, this is **bold** and `code`')
    const parsed = withMentions(stylesOf(markdown), [{ uuid: ANA, name: 'Ana' }])
    expect(parsed.text).toBe(text)
    expect(parsed.mentions).toEqual([{ start: 3, length: 1, uuid: ANA }])
    expect(parsed.spans).toEqual([
      { start: 14, length: 4, style: 'BOLD' },
      { start: 23, length: 4, style: 'MONOSPACE' },
    ])
  })

  it('keeps every style and escapes what would read as markup', () => {
    const spans = stylesOf('_it_ ~~gone~~ ||secret|| a\\*b').spans.map((one) => one.style)
    expect(spans).toEqual(['ITALIC', 'STRIKETHROUGH', 'SPOILER'])
    expect(stylesOf('_it_ ~~gone~~ ||secret|| a\\*b').text).toBe('it gone secret a*b')
    expect(markdownOf('2*3=6 | a_b', [])).toBe('2\\*3=6 \\| a\\_b')
    expect(stylesOf(markdownOf('2*3=6 | a_b', [])).text).toBe('2*3=6 | a_b')
  })

  it('counts in UTF-16 units as Signal does', () => {
    const parsed = stylesOf('😀 **hi**')
    expect(parsed.spans).toEqual([{ start: 3, length: 2, style: 'BOLD' }])
  })
})

describe('signal-cli over its pipe', () => {
  it('sends only ASCII and reads lines that arrive in pieces', async () => {
    const cli = linked()
    cli.chunk = 7
    const rpc = new Rpc(cli.program())
    await expect(rpc.call('listAccounts')).resolves.toEqual(cli.accounts)
    expect(ascii({ text: 'grüezi 😀' })).toBe('{"text":"gr\\u00fcezi \\ud83d\\ude00"}')
    expect(JSON.parse(ascii({ text: 'grüezi 😀' }))).toEqual({ text: 'grüezi 😀' })
    cli.refuse.set('listGroups', 'Specified account does not exist')
    await expect(rpc.call('listGroups', { account: '+1' })).rejects.toThrow(
      'Specified account does not exist',
    )
    cli.stop()
    await expect(rpc.call('listAccounts')).rejects.toThrow('signal-cli stopped')
  })
})

describe('signal kept history', () => {
  it('keeps nothing readable on the device and nothing after the account is forgotten', async () => {
    const cli = linked()
    const host = new TestHost(cli)
    const store = memoryStore()
    const kept = await keptFor(store, host, ME)
    await kept.write('c:u:x', [{ text: 'the secret plan' }])
    await kept.keepBytes('f:1', new TextEncoder().encode('a private picture'))
    const everything = [...store.rows.values()].map((one) => new TextDecoder().decode(one)).join('')
    expect(everything).not.toContain('secret plan')
    expect(everything).not.toContain('private picture')
    expect([...store.rows.keys()].join('')).not.toContain('c:u:x')
    expect(await kept.read('c:u:x')).toEqual([{ text: 'the secret plan' }])
    const again = await keptFor(store, host, ME)
    expect(new TextDecoder().decode((await again.bytes('f:1')) ?? new Uint8Array())).toBe(
      'a private picture',
    )
    await kept.forget()
    expect(store.rows.size).toBe(0)
    expect(host.bigs.size).toBe(0)
  })
})

describe('signal linking', () => {
  it('links as a new device by QR code and asks the phone for contacts and groups', async () => {
    const cli = new FakeSignalCli()
    const host = new TestHost(cli)
    cli.linking = { number: '+41790000009', aci: ME }
    const provider = signalProvider({ store: memoryStore })
    expect(provider.available(host)).toBe(true)
    expect(
      provider.available({
        fetch: host.fetch,
        now: () => 0,
        secret: () => Promise.resolve(null),
        keepSecret: () => Promise.resolve(),
        show: host.show,
        sealed: host.sealed,
      }),
    ).toBe(false)
    const linking = provider.connect({ device: 'Laptop' }, host, undefined)
    await until(() => host.shown.some((one) => one?.kind === 'qr'))
    const qr = host.shown.find((one) => one?.kind === 'qr')
    expect(qr).toMatchObject({ kind: 'qr', data: 'sgnl://linkdevice?uuid=fake&pub_key=fake' })
    cli.scan()
    const connection = await linking
    opened.push(connection)
    expect(connection.account).toMatchObject({ id: ME, label: '+41790000009' })
    expect(lastCall(cli, 'finishLink')).toMatchObject({ deviceName: 'Laptop' })
    expect(lastCall(cli, 'sendSyncRequest')).toEqual({ account: '+41790000009' })
    expect(host.shown.at(-1)).toBeNull()
  })

  it('says the code ran out when the phone never scans it', async () => {
    const cli = new FakeSignalCli()
    const host = new TestHost(cli)
    const linking = signalProvider({ store: memoryStore }).connect({}, host, undefined)
    await until(() => host.shown.some((one) => one?.kind === 'qr'))
    cli.scan()
    await expect(linking).rejects.toThrow('The code ran out before it was scanned. Try again.')
    expect(host.shown.at(-1)).toBeNull()
  })

  it('is signed out when signal-cli no longer has the account', async () => {
    const cli = linked()
    cli.accounts = []
    const host = new TestHost(cli)
    await expect(signalProvider({ store: memoryStore }).connect({}, host, ME)).rejects.toThrow(
      'Signed out of Signal. Link Orden again.',
    )
  })

  it('shares one signal-cli between accounts and windows of one host and ends it with the last', async () => {
    const cli = linked()
    cli.accounts.push({ number: '+41790000005', aci: BEN })
    const host = new TestHost(cli)
    const provider = signalProvider({ store: memoryStore })
    const one = await provider.connect({}, host, ME)
    const two = await provider.connect({}, host, BEN)
    expect(cli.started).toBe(1)
    await one.close()
    expect(cli.calls.at(-1)?.method).toBe('unsubscribeReceive')
    await two.close()
    opened.push(await provider.connect({}, host, ME))
    expect(cli.started).toBe(2)
  })

  it('unlinks and forgets what it kept when the account is removed', async () => {
    const store = memoryStore()
    const { cli, host, connection, heard } = await connected(linked(), store)
    incoming(cli, { timestamp: 5, dataMessage: { timestamp: 5, message: 'hello' } })
    await until(() => heard.some((one) => one.t === 'message'))
    await connection.close()
    expect(store.rows.size).toBeGreaterThan(0)
    await signalProvider({ store: () => store }).forget?.(ME, host)
    expect(cli.calls.some((one) => one.method === 'unregister')).toBe(true)
    expect(cli.calls.some((one) => one.method === 'deleteLocalAccountData')).toBe(true)
    expect(store.rows.size).toBe(0)
    opened.splice(0)
  })
})

describe('signal conversations', () => {
  it('lists groups with their members and roles and contacts by name', async () => {
    const { connection } = await connected()
    const list = await connection.conversations()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: `g:${GROUP}`,
      title: 'Climbing',
      kind: 'group',
      topic: 'Tuesdays',
      role: 'admin',
      members: 3,
      readOnly: false,
    })
    expect(list[0]?.people.map((one) => one.name)).toEqual(['Ana Muster', 'Ben'])
    const members = await connection.members?.(`g:${GROUP}`)
    expect(members?.map((one) => [one.id, one.role])).toEqual([
      [ME, 'admin'],
      [ANA, 'member'],
      [BEN, 'member'],
    ])
  })

  it('takes a message in, with styles, mentions, a quote, a file and a timer', async () => {
    const { cli, connection, heard } = await connected()
    cli.files.set('att1', new TextEncoder().encode('jpeg bytes'))
    incoming(cli, {
      timestamp: 1000,
      dataMessage: {
        timestamp: 1000,
        message: `${PLACE} look at this`,
        mentions: [{ start: 0, length: 1, uuid: BEN, name: 'Ben' }],
        textStyles: [{ start: 2, length: 4, style: 'BOLD' }],
        expiresInSeconds: 60,
        quote: { id: 900, authorUuid: ME, text: 'earlier' },
        attachments: [
          {
            id: 'att1',
            contentType: 'image/jpeg',
            filename: 'a.jpg',
            size: 10,
            width: 4,
            height: 3,
          },
        ],
        groupInfo: { groupId: GROUP, type: 'DELIVER' },
      },
    })
    await until(() => heard.some((one) => one.t === 'message'))
    const message = heard.find((one) => one.t === 'message')
    expect(message).toMatchObject({
      t: 'message',
      message: {
        id: `1000:${ANA}`,
        conversation: `g:${GROUP}`,
        text: '@Ben **look** at this',
        mentions: [BEN],
        replyTo: `900:${ME}`,
        expiresAt: 61_000,
        mine: false,
        author: { id: ANA, name: 'Ana Muster' },
        attachments: [
          { ref: 'a:att1', name: 'a.jpg', type: 'image/jpeg', kind: 'image', width: 4, height: 3 },
        ],
      },
    })
    await until(() => cli.calls.some((one) => one.method === 'getAttachment'))
    expect(lastCall(cli, 'getAttachment')).toMatchObject({ id: 'att1', groupId: GROUP })
    cli.files.clear()
    const bytes = await connection.attachment(`g:${GROUP}`, `1000:${ANA}`, 'a:att1')
    expect(new TextDecoder().decode(bytes)).toBe('jpeg bytes')
    const list = await connection.conversations()
    expect(list[0]).toMatchObject({ unread: 1, lastAt: 1000 })
  })

  it('keeps history only on this device, between launches, and pages back through it', async () => {
    const store = memoryStore()
    const first = await connected(linked(), store)
    for (let at = 1; at <= 5; at++)
      incoming(first.cli, { timestamp: at, dataMessage: { timestamp: at, message: `m${at}` } })
    await until(() => first.heard.filter((one) => one.t === 'message').length === 5)
    await first.connection.close()
    opened.splice(0)
    const again = await connected(first.cli, store, first.host)
    const page = await again.connection.history(`u:${ANA}`, { limit: 2 })
    expect(page.messages.map((one) => one.text)).toEqual(['m4', 'm5'])
    const earlier = await again.connection.history(`u:${ANA}`, {
      limit: 10,
      before: page.before ?? '',
    })
    expect(earlier.messages.map((one) => one.text)).toEqual(['m1', 'm2', 'm3'])
    expect(earlier.before).toBeNull()
    expect((await again.connection.conversations()).map((one) => one.id)).toContain(`u:${ANA}`)
    const found = await again.connection.search?.('m3')
    expect(found?.map((one) => one.id)).toEqual([`3:${ANA}`])
  })

  it('follows edits, reactions, deletions, pins, polls, receipts and typing', async () => {
    const { cli, connection, heard } = await connected()
    incoming(cli, { timestamp: 10, dataMessage: { timestamp: 10, message: 'first' } })
    await until(() => heard.some((one) => one.t === 'message'))
    const id = `10:${ANA}`
    incoming(cli, {
      timestamp: 11,
      editMessage: { targetSentTimestamp: 10, dataMessage: { timestamp: 11, message: 'second' } },
    })
    incoming(cli, {
      timestamp: 12,
      dataMessage: {
        timestamp: 12,
        reaction: { emoji: '👍', targetAuthorUuid: ANA, targetSentTimestamp: 10, isRemove: false },
      },
    })
    incoming(cli, {
      timestamp: 13,
      dataMessage: {
        timestamp: 13,
        pinMessage: { targetAuthorUuid: ANA, targetSentTimestamp: 10 },
      },
    })
    await until(() => heard.filter((one) => one.t === 'changed').length === 3)
    const changed = heard.filter((one) => one.t === 'changed').at(-1)
    expect(changed).toMatchObject({
      message: { id, text: 'second', editedAt: 11, reactions: { '👍': [ANA] }, pinned: true },
    })
    incoming(cli, {
      timestamp: 14,
      dataMessage: {
        timestamp: 14,
        reaction: { emoji: '❤️', targetAuthorUuid: ANA, targetSentTimestamp: 10, isRemove: false },
      },
    })
    incoming(cli, {
      timestamp: 15,
      dataMessage: { timestamp: 15, remoteDelete: { timestamp: 10 } },
    })
    await until(() => heard.filter((one) => one.t === 'changed').length === 5)
    expect(heard.filter((one) => one.t === 'changed')[3]).toMatchObject({
      message: { reactions: { '❤️': [ANA] } },
    })
    expect(heard.at(-1)).toMatchObject({ t: 'changed', message: { id, deleted: true, text: '' } })

    incoming(cli, {
      timestamp: 20,
      dataMessage: {
        timestamp: 20,
        pollCreate: { question: 'When?', options: ['Mon', 'Tue'], allowMultiple: false },
      },
    })
    await until(() => heard.filter((one) => one.t === 'message').length === 2)
    incoming(cli, {
      timestamp: 21,
      dataMessage: {
        timestamp: 21,
        pollVote: { authorUuid: ANA, targetSentTimestamp: 20, optionIndexes: [1], voteCount: 1 },
      },
    })
    await until(() => heard.at(-1)?.t === 'changed')
    expect(heard.at(-1)).toMatchObject({ message: { poll: { counts: [0, 1], several: false } } })
    await connection.vote?.(`u:${ANA}`, `20:${ANA}`, [0])
    expect(lastCall(cli, 'sendPollVote')).toMatchObject({
      recipient: [ANA],
      pollAuthor: ANA,
      pollTimestamp: 20,
      option: [0],
      voteCount: 1,
    })
    expect(heard.at(-1)).toMatchObject({ message: { poll: { counts: [1, 1], mine: [0] } } })

    incoming(cli, { timestamp: 30, typingMessage: { action: 'STARTED', timestamp: 30 } })
    await until(() => heard.at(-1)?.t === 'typing')
    expect(heard.at(-1)).toEqual({ t: 'typing', conversation: `u:${ANA}`, person: ANA, on: true })

    const sent = await connection.send(`u:${ANA}`, { text: 'out' })
    incoming(cli, {
      timestamp: 31,
      receiptMessage: { isDelivery: true, timestamps: [sent.at], when: 31 },
    })
    await until(() => heard.at(-1)?.t === 'changed')
    expect(heard.at(-1)).toMatchObject({ message: { id: sent.id, delivery: 'delivered' } })
    incoming(cli, {
      timestamp: 32,
      receiptMessage: { isRead: true, timestamps: [sent.at], when: 32 },
    })
    await until(() => heard.at(-1)?.t === 'read')
    expect(heard.at(-1)).toEqual({
      t: 'read',
      conversation: `u:${ANA}`,
      person: ANA,
      upTo: sent.id,
    })
  })

  it('takes in what was sent from the phone and what the phone has read', async () => {
    const { cli, connection, heard } = await connected()
    incoming(cli, { timestamp: 40, dataMessage: { timestamp: 40, message: 'unread' } })
    await until(() => heard.some((one) => one.t === 'message'))
    expect((await connection.conversations())[0]?.unread).toBe(1)
    cli.deliver('+41790000001', {
      sourceUuid: ME,
      timestamp: 41,
      syncMessage: {
        sentMessage: { destinationUuid: ANA, timestamp: 41, message: 'from my phone' },
        readMessages: [{ senderUuid: ANA, timestamp: 40 }],
      },
    })
    await until(() => heard.filter((one) => one.t === 'message').length === 2)
    const mine = heard.filter((one) => one.t === 'message').at(-1)
    expect(mine).toMatchObject({
      message: { id: `41:${ME}`, mine: true, conversation: `u:${ANA}` },
    })
    await until(() =>
      heard.some((one) => one.t === 'conversation' && one.conversation.unread === 0),
    )
  })
})

describe('signal sending', () => {
  it('sends styles, mentions, quotes, files, voice notes and stickers as signal-cli wants them', async () => {
    const { cli, connection, heard } = await connected()
    incoming(cli, {
      timestamp: 50,
      dataMessage: {
        timestamp: 50,
        message: 'quote me',
        textStyles: [{ start: 6, length: 2, style: 'BOLD' }],
        groupInfo: { groupId: GROUP },
      },
    })
    await until(() => heard.some((one) => one.t === 'message'))
    const message = await connection.send(`g:${GROUP}`, {
      text: 'hey @Ben, **now** ||later||',
      mentions: [BEN],
      replyTo: `50:${ANA}`,
      attachments: [
        { name: 'note.ogg', type: 'audio/ogg', bytes: new Uint8Array([1, 2, 3]), kind: 'voice' },
      ],
    })
    const params = lastCall(cli, 'send')
    expect(params).toMatchObject({
      account: '+41790000001',
      groupId: GROUP,
      message: `hey ${PLACE}, now later`,
      mention: [`4:1:${BEN}`],
      textStyle: ['7:3:BOLD', '11:5:SPOILER'],
      quoteTimestamp: 50,
      quoteAuthor: ANA,
      quoteMessage: 'quote me',
      voiceNote: true,
      attachment: ['data:audio/ogg;filename=note.ogg;base64,AQID'],
    })
    expect(message).toMatchObject({ mine: true, delivery: 'sent', replyTo: `50:${ANA}` })
    expect(message.attachments[0]).toMatchObject({ kind: 'voice', size: 3 })
    const back = await connection.attachment(
      `g:${GROUP}`,
      message.id,
      message.attachments[0]?.ref ?? '',
    )
    expect([...back]).toEqual([1, 2, 3])

    await connection.send(`u:${ANA}`, { text: '', sticker: 's:abcd:3' })
    expect(lastCall(cli, 'send')).toMatchObject({ recipient: [ANA], sticker: 'abcd:3' })
    await connection.send(`u:${ME}`, { text: 'to me' })
    expect(lastCall(cli, 'send')).toMatchObject({ noteToSelf: true })
    const poll = await connection.send(`g:${GROUP}`, {
      text: '',
      poll: { question: 'Where?', answers: ['Gym', 'Crag'], several: true },
    })
    expect(lastCall(cli, 'sendPollCreate')).toEqual({
      account: '+41790000001',
      groupId: GROUP,
      question: 'Where?',
      option: ['Gym', 'Crag'],
    })
    expect(poll.poll?.answers).toEqual(['Gym', 'Crag'])
  })

  it('edits, deletes, reacts, pins, types and marks read on the service', async () => {
    const { cli, connection, heard } = await connected()
    const sent = await connection.send(`u:${ANA}`, { text: 'tpyo' })
    await connection.edit?.(`u:${ANA}`, sent.id, { text: 'typo' })
    expect(lastCall(cli, 'send')).toMatchObject({ message: 'typo', editTimestamp: sent.at })
    await connection.react?.(`u:${ANA}`, sent.id, '🎉', true)
    expect(lastCall(cli, 'sendReaction')).toMatchObject({
      emoji: '🎉',
      targetAuthor: ME,
      targetTimestamp: sent.at,
    })
    await connection.react?.(`u:${ANA}`, sent.id, '🎉', false)
    expect(lastCall(cli, 'sendReaction')).toMatchObject({ remove: true })
    await connection.pin?.(`u:${ANA}`, sent.id, true)
    expect(lastCall(cli, 'sendPinMessage')).toMatchObject({
      targetAuthor: ME,
      targetTimestamp: sent.at,
    })
    await connection.typing?.(`u:${ANA}`, false)
    expect(lastCall(cli, 'sendTyping')).toEqual({
      account: '+41790000001',
      recipient: [ANA],
      stop: true,
    })
    await connection.remove?.(`u:${ANA}`, sent.id, true)
    expect(lastCall(cli, 'remoteDelete')).toMatchObject({
      recipient: [ANA],
      targetTimestamp: sent.at,
    })
    expect(heard.at(-1)).toMatchObject({ t: 'changed', message: { deleted: true } })
    await expect(connection.edit?.(`u:${ANA}`, `5:${ANA}`, { text: 'x' })).rejects.toThrow(
      'Signal changes only your own messages',
    )

    incoming(cli, { timestamp: 60, dataMessage: { timestamp: 60, message: 'a' } })
    incoming(cli, { timestamp: 61, dataMessage: { timestamp: 61, message: 'b' } })
    await until(() => heard.filter((one) => one.t === 'message').length === 3)
    await connection.markRead?.(`u:${ANA}`, `61:${ANA}`)
    expect(lastCall(cli, 'sendReceipt')).toEqual({
      account: '+41790000001',
      recipient: ANA,
      targetTimestamp: [60, 61],
      type: 'read',
    })
    await connection.remove?.(`u:${ANA}`, `60:${ANA}`, false)
    expect(heard.at(-1)).toEqual({ t: 'deleted', conversation: `u:${ANA}`, message: `60:${ANA}` })
    const left = await connection.history(`u:${ANA}`, { limit: 10 })
    expect(left.messages.map((one) => one.id)).not.toContain(`60:${ANA}`)
  })

  it('removes a disappearing message when its time is up', async () => {
    const { cli, connection, host, heard } = await connected()
    incoming(cli, {
      timestamp: host.clock,
      dataMessage: { timestamp: host.clock, message: 'gone soon', expiresInSeconds: 5 },
    })
    await until(() => heard.some((one) => one.t === 'message'))
    host.clock += 6000
    const page = await connection.history(`u:${ANA}`, { limit: 10 })
    expect(page.messages).toEqual([])
    expect(heard.at(-1)).toEqual({
      t: 'deleted',
      conversation: `u:${ANA}`,
      message: `${host.clock - 6000}:${ANA}`,
    })
  })
})

describe('signal groups and people', () => {
  it('starts chats and groups and manages a group', async () => {
    const { cli, connection } = await connected()
    const found = await connection.people?.('ana')
    expect(found?.map((one) => one.id)).toEqual([ANA])
    cli.contacts.push({ uuid: '44444444-4444-4444-8444-444444444444', number: '+41790000004' })
    const byNumber = await connection.people?.('+41 79 000 00 04')
    expect(byNumber?.[0]).toMatchObject({ phone: '+41790000004' })
    const direct = await connection.begin?.([ANA])
    expect(direct).toMatchObject({ id: `u:${ANA}`, kind: 'direct', title: 'Ana Muster' })
    const group = await connection.begin?.([ANA, BEN], 'Trip')
    expect(lastCall(cli, 'updateGroup')).toMatchObject({ name: 'Trip', member: [ANA, BEN] })
    expect(group).toMatchObject({ kind: 'group', title: 'Trip' })
    const id = `g:${GROUP}`
    await connection.invite?.(id, [ANA])
    expect(lastCall(cli, 'updateGroup')).toMatchObject({ groupId: GROUP, member: [ANA] })
    await connection.kick?.(id, BEN)
    expect(lastCall(cli, 'updateGroup')).toMatchObject({ removeMember: [BEN] })
    await connection.promote?.(id, ANA, 'admin')
    expect(lastCall(cli, 'updateGroup')).toMatchObject({ admin: [ANA] })
    await connection.promote?.(id, ANA, 'member')
    expect(lastCall(cli, 'updateGroup')).toMatchObject({ removeAdmin: [ANA] })
    await expect(connection.promote?.(id, ANA, 'owner')).rejects.toThrow(
      'Signal groups have admins',
    )
    await connection.rename?.(id, 'Bouldering')
    expect(lastCall(cli, 'updateGroup')).toMatchObject({ name: 'Bouldering' })
    await connection.describe?.(id, 'Thursdays')
    expect(lastCall(cli, 'updateGroup')).toMatchObject({ description: 'Thursdays' })
    await connection.archive?.(id, true)
    expect((await connection.conversations()).find((one) => one.id === id)?.archived).toBe(true)
    await connection.leave?.(id)
    expect(lastCall(cli, 'quitGroup')).toMatchObject({ groupId: GROUP })
    expect((await connection.conversations()).some((one) => one.id === id)).toBe(false)
  })

  it('lists installed stickers and reads pictures', async () => {
    const { cli, connection } = await connected()
    cli.stickers = [{ packId: 'abcd', title: 'Cats', stickers: [{ id: 3, emoji: '🐱' }] }]
    const sets = await connection.stickers?.()
    expect(sets).toEqual([
      {
        id: 'abcd',
        name: 'Cats',
        stickers: [{ ref: 's:abcd:3', name: '🐱', type: 'image/webp', emoji: '🐱' }],
      },
    ])
    const sticker = await connection.stickerBytes?.('s:abcd:3')
    expect(new TextDecoder().decode(sticker)).toBe('sticker abcd 3')
    cli.files.set(GROUP, new Uint8Array([9]))
    expect([...((await connection.picture?.(`g:${GROUP}`)) ?? [])]).toEqual([9])
    expect(await connection.picture?.(`u:${BEN}`)).toBeNull()
  })
})

describe('signal when signal-cli stops', () => {
  it('goes offline, starts it again and listens again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    const { cli, heard } = await connected()
    cli.stop()
    expect(heard.at(-1)).toMatchObject({ t: 'status', status: 'offline' })
    await vi.advanceTimersByTimeAsync(2500)
    vi.useRealTimers()
    const off = heard.findIndex((one) => one.t === 'status' && one.status === 'offline')
    await until(() => heard.slice(off).some((one) => one.t === 'status' && one.status === 'online'))
    expect(cli.started).toBe(2)
    incoming(cli, { timestamp: 70, dataMessage: { timestamp: 70, message: 'still here' } })
    await until(() => heard.at(-1)?.t === 'conversation')
    expect(heard.some((one) => one.t === 'message' && one.message.text === 'still here')).toBe(true)
  })
})
