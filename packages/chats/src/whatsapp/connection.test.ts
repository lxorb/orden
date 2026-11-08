import type { WAMessage } from '@whiskeysockets/baileys'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ProviderEvent } from '../provider'
import { cacheName } from './cache'
import { WORDS } from './connection'
import { ANNA, BEN, FakeHost, FakeKit, type FakeLink, GROUP, ME, incoming } from './fake'
import { whatsappProvider } from './index'
import { sealMedia } from './media'
import { authName } from './shelf'

const ACCOUNT = '41790000001'

function signsIn(link: FakeLink): void {
  link.fire('connection.update', { qr: 'QR-ONE' })
  link.fire('creds.update', {
    me: { id: `${ACCOUNT}:7@s.whatsapp.net`, name: 'Me' },
    registered: true,
  })
  link.open()
}

async function connected(host = new FakeHost(), kit = new FakeKit(), known?: string) {
  kit.onDial = (link) => (known ? link.open() : signsIn(link))
  const provider = whatsappProvider(() => Promise.resolve(kit))
  const connection = await provider.connect({}, host, known)
  const heard: ProviderEvent[] = []
  connection.start((event) => heard.push(event))
  return { host, kit, link: kit.link, connection, heard, provider }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('signing in', () => {
  test('shows the QR code, then keeps the sign-in sealed under the number', async () => {
    const { host, connection } = await connected()
    expect(host.shown[0]).toMatchObject({ kind: 'qr', data: 'QR-ONE', label: WORDS.scan })
    expect(host.shown.at(-1)).toBeNull()
    expect(connection.account).toMatchObject({
      id: ACCOUNT,
      label: `Me (+${ACCOUNT})`,
      self: { id: ME, name: 'Me' },
    })
    const kept = new TextDecoder().decode(host.bigs.get(authName(ACCOUNT)))
    expect(kept).toContain('"registered":true')
    expect([...host.secrets.values()]).toEqual([])
  })

  test('with a phone number it shows a pairing code instead', async () => {
    const kit = new FakeKit()
    const host = new FakeHost()
    kit.onDial = (link) => {
      link.fire('connection.update', { qr: 'QR-ONE' })
      setTimeout(() => signsIn(link), 0)
    }
    await whatsappProvider(() => Promise.resolve(kit)).connect({ phone: '+41 79 000 00 01' }, host)
    expect(kit.link.callsOf('pairingCode')).toEqual([[ACCOUNT]])
    expect(host.shown[0]).toMatchObject({ kind: 'wait', label: WORDS.code })
    expect(host.shown[0]?.note).toContain('ABCD-1234')
    expect(host.shown.some((one) => one?.kind === 'qr')).toBe(false)
  })

  test('the restart WhatsApp asks for after pairing dials again', async () => {
    const kit = new FakeKit()
    let dialed = 0
    kit.onDial = (link) => {
      dialed++
      if (dialed === 1) {
        link.fire('connection.update', { qr: 'QR-ONE' })
        link.fire('creds.update', { me: { id: `${ACCOUNT}:7@s.whatsapp.net` }, registered: true })
        link.drop(515)
      } else link.open()
    }
    const connection = await whatsappProvider(() => Promise.resolve(kit)).connect(
      {},
      new FakeHost(),
    )
    expect(kit.links).toHaveLength(2)
    expect(connection.account.id).toBe(ACCOUNT)
  })

  test('an unscanned QR code expires and nothing is kept', async () => {
    const kit = new FakeKit()
    const host = new FakeHost()
    kit.onDial = (link) => {
      link.fire('connection.update', { qr: 'QR-ONE' })
      link.drop(408)
    }
    await expect(whatsappProvider(() => Promise.resolve(kit)).connect({}, host)).rejects.toThrow(
      WORDS.expired,
    )
    expect(host.bigs.size).toBe(0)
  })

  test('when WhatsApp never sends a code, connecting stops with a reason instead of waiting forever', async () => {
    vi.useFakeTimers()
    const kit = new FakeKit()
    const host = new FakeHost()
    kit.onDial = () => undefined
    const connecting = whatsappProvider(() => Promise.resolve(kit)).connect({}, host)
    const failed = expect(connecting).rejects.toThrow(WORDS.noAnswer)
    await vi.advanceTimersByTimeAsync(30_000)
    await failed
    expect(kit.link.closed).toBe(true)
    expect(host.logged.some((one) => one.includes(WORDS.noAnswer))).toBe(true)
    expect(host.bigs.size).toBe(0)
  })

  test('the reason says why the connection would not open, and is logged', async () => {
    vi.useFakeTimers()
    const kit = new FakeKit()
    const host = new FakeHost()
    kit.onDial = (link) => {
      if (kit.links.length === 1) link.drop(428, 'web.whatsapp.com could not be reached')
    }
    const connecting = whatsappProvider(() => Promise.resolve(kit)).connect({}, host)
    const failed = expect(connecting).rejects.toThrow(
      `${WORDS.noAnswer} (web.whatsapp.com could not be reached (428))`,
    )
    await vi.advanceTimersByTimeAsync(40_000)
    await failed
    expect(host.logged).toContain(
      'warn WhatsApp: the connection closed: web.whatsapp.com could not be reached (428)',
    )
  })

  test('a QR code on the screen is waited on until WhatsApp says it expired', async () => {
    vi.useFakeTimers()
    const kit = new FakeKit()
    const host = new FakeHost()
    kit.onDial = (link) => link.fire('connection.update', { qr: 'QR-ONE' })
    let settled = false
    const connecting = whatsappProvider(() => Promise.resolve(kit))
      .connect({}, host)
      .finally(() => (settled = true))
    const failed = expect(connecting).rejects.toThrow(WORDS.expired)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(settled).toBe(false)
    kit.link.drop(408)
    await failed
  })

  test('a connection dropped before pairing asks the new one for a fresh pairing code', async () => {
    vi.useFakeTimers()
    const kit = new FakeKit()
    const host = new FakeHost()
    kit.onDial = (link) => {
      link.fire('connection.update', { qr: 'QR-ONE' })
      if (kit.links.length === 1) setTimeout(() => link.drop(428), 0)
      else setTimeout(() => signsIn(link), 0)
    }
    const connecting = whatsappProvider(() => Promise.resolve(kit)).connect(
      { phone: '+41 79 000 00 01' },
      host,
    )
    await vi.advanceTimersByTimeAsync(5000)
    await connecting
    expect(kit.links.map((one) => one.callsOf('pairingCode').length)).toEqual([1, 1])
  })

  test('without a kept sign-in a saved account asks to connect again', async () => {
    await expect(
      whatsappProvider(() => Promise.resolve(new FakeKit())).connect({}, new FakeHost(), ACCOUNT),
    ).rejects.toThrow(WORDS.signedOut)
  })
})

function history(link: FakeLink): void {
  link.fire('messaging-history.set', {
    chats: [
      { id: ANNA, unreadCount: 1, conversationTimestamp: 1_800_000_002 },
      { id: GROUP, name: 'Climbing', archived: true, muteEndTime: 1_900_000_000_000 },
    ],
    contacts: [
      { id: ANNA, name: 'Anna Muster' },
      { id: BEN, notify: 'Ben' },
    ],
    messages: [
      incoming('A1', ANNA, { conversation: 'hello *there*' }),
      incoming('A2', ANNA, { conversation: 'are you coming?' }),
      incoming(
        'G1',
        GROUP,
        { conversation: 'rope?' },
        { key: { participant: BEN }, pushName: 'Ben' },
      ),
    ],
    isLatest: true,
  })
}

describe('reading', () => {
  test('history sync lists conversations and their messages', async () => {
    const { link, connection } = await connected()
    link.groupList = {
      [GROUP]: {
        id: GROUP,
        subject: 'Climbing',
        desc: 'Thursdays',
        participants: [
          { id: ME, admin: 'admin' },
          { id: BEN, admin: null },
        ],
      } as never,
    }
    history(link)
    link.fire('groups.upsert', [link.groupList[GROUP] as never])
    const list = await connection.conversations()
    expect(list.map((one) => [one.id, one.title, one.kind])).toEqual([
      [ANNA, 'Anna Muster', 'direct'],
      [GROUP, 'Climbing', 'group'],
    ])
    expect(list[0]).toMatchObject({
      unread: 1,
      snippet: 'are you coming?',
      people: [{ id: ANNA, phone: '+41790000002' }],
    })
    expect(list[1]).toMatchObject({
      archived: true,
      mutedUntil: 1_900_000_000_000,
      topic: 'Thursdays',
      role: 'admin',
      members: 2,
    })
    const page = await connection.history(ANNA, { limit: 1 })
    expect(page.messages.map((one) => one.text)).toEqual(['are you coming?'])
    expect(page.before).toBe('A2')
    const older = await connection.history(ANNA, { limit: 1, before: 'A2' })
    expect(older.messages.map((one) => one.text)).toEqual(['hello **there**'])
  })

  test('asks the phone for older messages when the device has no more', async () => {
    const { link, connection } = await connected()
    history(link)
    link.onOlder = (_count, oldest) => {
      expect(oldest.id).toBe('A1')
      link.fire('messaging-history.set', {
        chats: [],
        contacts: [],
        messages: [incoming('A0', ANNA, { conversation: 'earlier' })],
      })
    }
    const page = await connection.history(ANNA, { limit: 5, before: 'A1' })
    expect(page.messages.map((one) => one.id)).toEqual(['A0'])
  })

  test('live messages, reactions, edits, deletions, receipts and typing', async () => {
    const { link, connection, heard } = await connected()
    history(link)
    heard.length = 0
    link.fire('messages.upsert', {
      type: 'notify',
      messages: [
        incoming('A3', ANNA, {
          extendedTextMessage: {
            text: '@41790000001 see _this_',
            contextInfo: { stanzaId: 'A1', mentionedJid: [ME] },
          },
        }),
      ],
    })
    expect(heard[0]).toMatchObject({
      t: 'message',
      message: { id: 'A3', text: '@Me see _this_', replyTo: 'A1', mentions: [ME], mine: false },
    })
    expect((await connection.conversations())[0]?.unread).toBe(2)
    link.fire('messages.reaction', [
      {
        key: { remoteJid: ANNA, id: 'A3' },
        reaction: { key: { remoteJid: ANNA, fromMe: false }, text: '❤️' },
      },
    ])
    link.fire('messages.upsert', {
      type: 'notify',
      messages: [
        incoming(
          'R1',
          ANNA,
          { reactionMessage: { key: { remoteJid: ANNA, id: 'A3', fromMe: false }, text: '😂' } },
          { key: { fromMe: true } },
        ),
      ],
    })
    expect(heard.filter((one) => one.t === 'changed').at(-1)).toMatchObject({
      message: { id: 'A3', reactions: { '❤️': [ANNA], '😂': [ME] } },
    })
    link.fire('messages.upsert', {
      type: 'notify',
      messages: [
        incoming('E1', ANNA, {
          protocolMessage: {
            type: 14,
            key: { remoteJid: ANNA, id: 'A3' },
            editedMessage: { conversation: 'fixed' },
          },
        }),
      ],
    })
    expect(heard.at(-1)).toMatchObject({ t: 'changed', message: { id: 'A3', text: 'fixed' } })
    expect((heard.at(-1) as { message: { editedAt?: number } }).message.editedAt).toBeTypeOf(
      'number',
    )
    link.fire('messages.upsert', {
      type: 'notify',
      messages: [
        incoming('D1', ANNA, { protocolMessage: { type: 0, key: { remoteJid: ANNA, id: 'A2' } } }),
      ],
    })
    expect(heard.at(-1)).toMatchObject({ t: 'changed', message: { id: 'A2', deleted: true } })
    link.fire('message-receipt.update', [
      { key: { remoteJid: GROUP, id: 'G1' }, receipt: { userJid: BEN, readTimestamp: 5 } },
    ])
    expect(heard.at(-1)).toEqual({ t: 'read', conversation: GROUP, person: BEN, upTo: 'G1' })
    link.fire('presence.update', {
      id: ANNA,
      presences: { [ANNA]: { lastKnownPresence: 'composing' } },
    })
    expect(heard.at(-1)).toEqual({ t: 'typing', conversation: ANNA, person: ANNA, on: true })
    link.fire('presence.update', {
      id: ANNA,
      presences: { [ANNA]: { lastKnownPresence: 'unavailable', lastSeen: 1_800_000_100 } },
    })
    expect(heard.at(-1)).toEqual({
      t: 'presence',
      person: ANNA,
      online: false,
      lastSeen: 1_800_000_100_000,
    })
    link.fire('messages.delete', { keys: [{ remoteJid: ANNA, id: 'A1' }] })
    expect(heard.at(-1)).toEqual({ t: 'deleted', conversation: ANNA, message: 'A1' })
    const pin = incoming('P1', ANNA, {
      pinInChatMessage: { key: { remoteJid: ANNA, id: 'A3' }, type: 1 },
    })
    link.fire('messages.upsert', { type: 'notify', messages: [pin] })
    expect(heard.at(-1)).toMatchObject({ t: 'changed', message: { id: 'A3', pinned: true } })
  })

  test('search covers the messages on this device', async () => {
    const { link, connection } = await connected()
    history(link)
    expect((await connection.search?.('ROPE'))?.map((one) => one.id)).toEqual(['G1'])
    expect(await connection.search?.('rope', ANNA)).toEqual([])
  })
})

describe('writing', () => {
  test('a reply with a mention and formatting, into a disappearing chat', async () => {
    const { link, connection } = await connected()
    history(link)
    link.fire('chats.update', [{ id: ANNA, ephemeralExpiration: 86400 }])
    const sent = await connection.send(ANNA, {
      text: 'hi @Anna Muster, **sure**',
      mentions: [ANNA],
      replyTo: 'A2',
    })
    const [jid, content, options] = link.callsOf('send')[0] as [
      string,
      { text: string; mentions: string[] },
      { quoted?: WAMessage; ephemeralExpiration?: number },
    ]
    expect(jid).toBe(ANNA)
    expect(content).toEqual({ text: 'hi @41790000002, *sure*', mentions: [ANNA] })
    expect(options.quoted?.key.id).toBe('A2')
    expect(options.ephemeralExpiration).toBe(86400)
    expect(sent).toMatchObject({ mine: true, replyTo: 'A2', delivery: 'sent' })
  })

  test('a photo is sealed, uploaded and sent with its caption', async () => {
    const { host, link, connection } = await connected()
    history(link)
    host.answers = () =>
      new Response(JSON.stringify({ url: 'https://mmg.example/u', direct_path: '/v/u' }))
    const sent = await connection.send(ANNA, {
      text: 'look',
      attachments: [
        {
          name: 'a.jpg',
          type: 'image/jpeg',
          bytes: new Uint8Array([1, 2, 3]),
          width: 2,
          height: 1,
        },
      ],
    })
    expect(host.fetched[0]?.url).toMatch(
      /^https:\/\/mmg\.example\/mms\/image\/[\w-]+\?auth=secret%20auth&token=/,
    )
    const [, message] = link.callsOf('relay')[0] as [
      string,
      { imageMessage: Record<string, unknown> },
    ]
    expect(message.imageMessage).toMatchObject({
      caption: 'look',
      directPath: '/v/u',
      width: 2,
      height: 1,
      fileLength: 3,
      mimetype: 'image/jpeg',
    })
    expect(sent.attachments[0]).toMatchObject({ kind: 'image', name: 'photo.jpg' })
    expect(link.callsOf('send')).toEqual([])
  })

  test('a voice note goes as ptt with its waveform', async () => {
    const { host, link, connection } = await connected()
    host.answers = () => new Response(JSON.stringify({ url: 'https://u', direct_path: '/v' }))
    await connection.send(ANNA, {
      text: '',
      attachments: [
        {
          name: 'v.ogg',
          type: 'audio/ogg',
          kind: 'voice',
          bytes: new Uint8Array([1]),
          seconds: 2.4,
          wave: [0, 0.5, 1],
        },
      ],
    })
    const [, message] = link.callsOf('relay')[0] as [
      string,
      { audioMessage: { ptt: boolean; seconds: number; waveform: Uint8Array; mimetype: string } },
    ]
    expect(message.audioMessage).toMatchObject({
      ptt: true,
      seconds: 2,
      mimetype: 'audio/ogg; codecs=opus',
    })
    expect([...message.audioMessage.waveform]).toEqual([0, 50, 100])
  })

  test('react, edit, delete for everyone or for me, pin', async () => {
    const { link, connection } = await connected()
    history(link)
    const mine = await connection.send(ANNA, { text: 'typo' })
    await connection.react?.(ANNA, 'A2', '👍', true)
    await connection.edit?.(ANNA, mine.id, { text: 'fixed' })
    await connection.pin?.(ANNA, 'A2', true)
    await connection.remove?.(ANNA, mine.id, true)
    await connection.remove?.(ANNA, 'A1', false)
    const sends = link.callsOf('send').map((one) => one[1])
    expect(sends[1]).toEqual({
      react: { text: '👍', key: { remoteJid: ANNA, fromMe: false, id: 'A2' } },
    })
    expect(sends[2]).toMatchObject({ text: 'fixed', edit: { id: mine.id } })
    expect(sends[3]).toMatchObject({ pin: { id: 'A2' }, type: 1, time: 604800 })
    expect(sends[4]).toMatchObject({ delete: { id: mine.id } })
    expect(link.callsOf('modify')[0]?.[0]).toMatchObject({ deleteForMe: { key: { id: 'A1' } } })
    const page = await connection.history(ANNA, { limit: 10 })
    expect(page.messages.find((one) => one.id === 'A2')).toMatchObject({
      pinned: true,
      reactions: { '👍': [ME] },
    })
    expect(page.messages.find((one) => one.id === mine.id)?.deleted).toBe(true)
    expect(page.messages.some((one) => one.id === 'A1')).toBe(false)
  })

  test('a poll is created, voted on and counted', async () => {
    const { link, connection } = await connected()
    history(link)
    link.fire('messages.upsert', {
      type: 'notify',
      messages: [
        incoming('Q9', ANNA, {
          pollCreationMessage: {
            name: 'When?',
            options: [{ optionName: 'Mon' }, { optionName: 'Tue' }],
            selectableOptionsCount: 1,
          },
          messageContextInfo: { messageSecret: new Uint8Array(32) },
        }),
      ],
    })
    await connection.vote?.(ANNA, 'Q9', [1])
    expect(link.callsOf('relay')[0]?.[1]).toMatchObject({
      pollUpdateMessage: { pollCreationMessageKey: { id: 'Q9' } },
    })
    const poll = (await connection.history(ANNA, { limit: 10 })).messages.find(
      (one) => one.id === 'Q9',
    )?.poll
    expect(poll).toMatchObject({
      question: 'When?',
      answers: ['Mon', 'Tue'],
      several: false,
      counts: [0, 1],
      mine: [1],
    })
    const created = await connection.send(ANNA, {
      text: '',
      poll: { question: 'Where?', answers: ['A', 'B'], several: true },
    })
    expect(link.callsOf('send')[0]?.[1]).toEqual({
      poll: { name: 'Where?', values: ['A', 'B'], selectableCount: 0 },
    })
    expect(created.poll).toMatchObject({ question: 'Where?', several: true })
  })

  test('chat settings, groups and people', async () => {
    const { link, connection } = await connected()
    history(link)
    link.existing['41790000009'] = '41790000009@s.whatsapp.net'
    await connection.archive?.(ANNA, true)
    await connection.pinConversation?.(ANNA, true)
    await connection.mute?.(ANNA, 1_900_000_000_000)
    await connection.markUnread?.(ANNA)
    await connection.typing?.(ANNA, true)
    await connection.invite?.(GROUP, ['+41 79 000 00 09'])
    await connection.kick?.(GROUP, BEN)
    await connection.promote?.(GROUP, BEN, 'admin')
    await expect(connection.promote?.(GROUP, BEN, 'owner')).rejects.toThrow(WORDS.owner)
    await connection.rename?.(GROUP, 'Bouldering')
    await connection.describe?.(GROUP, 'Fridays')
    await connection.leave?.(GROUP)
    await expect(connection.leave?.(ANNA)).rejects.toThrow(WORDS.notHere)
    expect(link.callsOf('modify').map((one) => Object.keys(one[0] as object)[0])).toEqual([
      'archive',
      'pin',
      'mute',
      'markRead',
    ])
    expect(link.callsOf('participants')).toEqual([
      [GROUP, ['41790000009@s.whatsapp.net'], 'add'],
      [GROUP, [BEN], 'remove'],
      [GROUP, [BEN], 'promote'],
    ])
    expect(link.callsOf('presence')).toEqual([['composing', ANNA]])
    const anna = (await connection.conversations()).find((one) => one.id === ANNA)
    expect(anna).toMatchObject({
      archived: true,
      pinned: true,
      mutedUntil: 1_900_000_000_000,
      unread: 1,
    })
    expect((await connection.people?.('ben'))?.map((one) => one.id)).toEqual([BEN])
    await expect(connection.begin?.(['+41 79 999 99 99'])).rejects.toThrow(WORDS.unknownNumber)
    const begun = await connection.begin?.(['41790000009'])
    expect(begun).toMatchObject({ id: '41790000009@s.whatsapp.net', kind: 'direct' })
    const group = await connection.begin?.([ANNA, BEN], 'Trip')
    expect(group).toMatchObject({ kind: 'group', title: 'Trip' })
  })

  test('a file is fetched and opened, and asked again from the phone once expired', async () => {
    const { host, link, connection } = await connected()
    const plain = new TextEncoder().encode('the file')
    const sealed = await sealMedia(plain, 'document')
    link.fire('messages.upsert', {
      type: 'notify',
      messages: [
        incoming('F1', ANNA, {
          documentMessage: {
            fileName: 'f.txt',
            mimetype: 'text/plain',
            mediaKey: sealed.mediaKey,
            directPath: '/old',
          },
        }),
      ],
    })
    link.reuploaded = (message) => ({
      ...message,
      message: { documentMessage: { ...message.message?.documentMessage, directPath: '/new' } },
    })
    host.answers = (url) =>
      url.endsWith('/old') ? new Response(null, { status: 410 }) : new Response(sealed.body.slice())
    expect(await connection.attachment(ANNA, 'F1', 'media')).toEqual(plain)
    expect(host.fetched.map((one) => one.url)).toEqual([
      'https://mmg.whatsapp.net/old',
      'https://mmg.whatsapp.net/new',
    ])
    expect(link.callsOf('reupload')).toEqual([['F1']])
  })
})

describe('staying connected', () => {
  test('a dropped connection says offline and dials again', async () => {
    vi.useFakeTimers()
    const { kit, link, heard } = await connected()
    kit.onDial = (next) => next.open()
    link.drop(428)
    expect(heard.at(-1)).toEqual({ t: 'status', status: 'offline' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(kit.links).toHaveLength(2)
    expect(heard.at(-1)).toEqual({ t: 'status', status: 'online' })
  })

  test('signed out on the phone forgets everything on this device', async () => {
    const { host, link, heard } = await connected()
    history(link)
    link.drop(401)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(heard.at(-1)).toEqual({ t: 'status', status: 'signed-out', reason: WORDS.signedOut })
    expect(host.bigs.size).toBe(0)
  })

  test('closing keeps the cache sealed, so the next launch starts with it', async () => {
    const { host, link, connection } = await connected()
    history(link)
    await connection.close()
    expect(host.bigs.has(cacheName(ACCOUNT))).toBe(true)
    const again = await connected(host, new FakeKit(), ACCOUNT)
    const list = await again.connection.conversations()
    expect(list.map((one) => one.title)).toContain('Anna Muster')
    expect((await again.connection.history(ANNA, { limit: 1 })).messages[0]?.text).toBe(
      'are you coming?',
    )
  })

  test('disconnecting logs this device out and removes what it kept', async () => {
    const { host, link, provider } = await connected()
    history(link)
    await provider.forget?.(ACCOUNT, host)
    expect(link.loggedOut).toBe(true)
    expect(host.bigs.size).toBe(0)
  })
})
