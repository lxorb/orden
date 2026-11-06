import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Host, ProviderEvent } from '../provider'
import { secretName } from '../provider'
import { ascii, fromBase64, latin } from './bytes'
import { FakeMail, nodeSocket } from './fake-server'
import { itemsOf, parseValues, untaggedOf } from './imap'
import {
  addressesOf,
  buildMessage,
  decodeWords,
  parseMessage,
  valueWithParams,
  withoutQuote,
} from './mime'
import { configOf, guessServers, mailProvider, sentBox } from './provider'
import { dotStuffed } from './smtp'
import { bareSubject, threadsOf } from './threads'

describe('IMAP responses', () => {
  test('lists, strings, NIL, literals and section atoms', () => {
    const values = parseValues(
      '(UID 7 FLAGS (\\Seen) ENVELOPE ("Mon" "a \\"b\\"" NIL) BODY[HEADER.FIELDS (REFERENCES)] {5}ab\r\nc)',
    )
    expect(values).toEqual([
      [
        'UID',
        '7',
        'FLAGS',
        ['\\Seen'],
        'ENVELOPE',
        ['Mon', 'a "b"', null],
        'BODY[HEADER.FIELDS (REFERENCES)]',
        'ab\r\nc',
      ],
    ])
  })

  test('a FETCH line, by its items', () => {
    const line = untaggedOf('* 3 FETCH (UID 12 FLAGS ())')
    expect(line).toMatchObject({ kind: 'FETCH', number: 3 })
    expect(itemsOf(line.values).get('UID')).toBe('12')
  })

  test('the sent box, by its mark or its name', () => {
    expect(sentBox([untaggedOf('* LIST (\\HasNoChildren \\Sent) "/" "Gesendet"')])).toBe('Gesendet')
    expect(sentBox([untaggedOf('* LIST () "." "INBOX.Sent"')])).toBe('INBOX.Sent')
    expect(sentBox([untaggedOf('* LIST () "/" "Drafts"')])).toBeNull()
  })
})

describe('MIME', () => {
  test('encoded words, in both encodings and run together', () => {
    expect(decodeWords('=?utf-8?Q?Gr=C3=BC=C3=9Fe_aus?= =?UTF-8?B?WsO8cmljaA==?=')).toBe(
      'Grüße ausZürich',
    )
    expect(decodeWords('=?iso-8859-1?q?caf=E9?=')).toBe('café')
  })

  test('addresses with names, quotes and commas', () => {
    expect(addressesOf('"Vinu, Emil" <Emil@Example.org>, lucile@example.org')).toEqual([
      { name: 'Vinu, Emil', address: 'emil@example.org' },
      { name: '', address: 'lucile@example.org' },
    ])
  })

  test('RFC 2231 names, continued and in a charset', () => {
    const { params } = valueWithParams(
      "attachment; filename*0*=utf-8''Gr%C3%BC; filename*1*=%C3%9Fe.pdf",
    )
    expect(params.filename).toBe('Grüße.pdf')
  })

  test('a multipart message: the plain words, and the file beside them', () => {
    const raw = [
      'From: Lucile <lucile@example.org>',
      'Subject: =?utf-8?Q?Kapitel_3?=',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary=inner',
      '',
      '--inner',
      'Content-Type: text/plain; charset=iso-8859-1',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Sch=F6n, bis morgen=',
      '!',
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Schön</p>',
      '--inner--',
      '--outer',
      'Content-Type: application/pdf; name="draft.pdf"',
      'Content-Disposition: attachment; filename="draft.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0=',
      '--outer--',
      '',
    ].join('\r\n')
    const parsed = parseMessage(ascii(raw))
    expect(parsed.text).toBe('Schön, bis morgen!')
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]).toMatchObject({ filename: 'draft.pdf', type: 'application/pdf' })
    expect(latin(parsed.attachments[0]?.bytes ?? new Uint8Array())).toBe('%PDF-')
  })

  test('an HTML-only mail reads as its words', () => {
    const parsed = parseMessage(
      ascii('Content-Type: text/html\r\n\r\n<div>Hi&nbsp;there<br>second &amp; last</div>'),
    )
    expect(parsed.text).toBe('Hi there\nsecond & last')
  })

  test('a reply without what it quotes', () => {
    expect(
      withoutQuote('Sounds good.\n\nOn Mon, 3 Nov 2026, Lucile wrote:\n> Lunch?\n> At noon\n'),
    ).toBe('Sounds good.')
    expect(withoutQuote('> only a quote')).toBe('> only a quote')
    expect(withoutQuote('Am 3. Nov. 2026 schrieb Emil:\n> x\nnot a trailing quote')).toContain(
      'not a trailing quote',
    )
  })

  test('a message written reads back as written', () => {
    const bytes = buildMessage({
      from: { name: 'Émil', address: 'emil@example.org' },
      to: [{ name: 'Lucile', address: 'lucile@example.org' }],
      subject: 'Re: Grüße',
      text: 'Bis morgen\n.\nund dann',
      messageId: 'abc@example.org',
      inReplyTo: 'one@example.org',
      references: ['zero@example.org', 'one@example.org'],
      date: new Date(Date.UTC(2026, 10, 6, 12)),
      attachments: [{ name: 'Plan ü.txt', type: 'text/plain', bytes: ascii('plan') }],
    })
    const parsed = parseMessage(bytes)
    expect(decodeWords(parsed.headers.get('subject')?.[0] ?? '')).toBe('Re: Grüße')
    expect(parsed.headers.get('in-reply-to')).toEqual(['<one@example.org>'])
    expect(parsed.text).toBe('Bis morgen\n.\nund dann')
    expect(parsed.attachments[0]?.filename).toBe('Plan ü.txt')
    expect(latin(dotStuffed(ascii('a\n.\nb')))).toBe('a\r\n..\r\nb\r\n.\r\n')
  })
})

describe('threads', () => {
  test('replies join the earliest mail, whichever order they arrive in', () => {
    const threads = threadsOf([
      { key: 'c', id: 'c@x', links: ['a@x', 'b@x'], at: 3 },
      { key: 'a', id: 'a@x', links: [], at: 1 },
      { key: 'z', id: 'z@x', links: [], at: 2 },
      { key: 'b', id: 'b@x', links: ['a@x'], at: 2 },
    ])
    expect(threads.get('a')).toBe('a@x')
    expect(threads.get('b')).toBe('a@x')
    expect(threads.get('c')).toBe('a@x')
    expect(threads.get('z')).toBe('z@x')
    expect(bareSubject('Re: AW: Fwd: Lunch')).toBe('Lunch')
  })
})

describe('connecting', () => {
  test('servers guessed from the address, and ports that say their security', () => {
    expect(guessServers('a@gmail.com')).toMatchObject({
      imapHost: 'imap.gmail.com',
      smtpPort: '465',
    })
    expect(guessServers('a@example.org').imapHost).toBe('imap.example.org')
    const config = configOf({ address: 'a@example.org', smtpPort: '587' })
    expect(config.smtp).toEqual({ host: 'smtp.example.org', port: 587, tls: 'starttls' })
    expect(config.imap.tls).toBe('tls')
    expect(config.user).toBe('a@example.org')
    expect(configOf({ address: 'a@example.org', imapHost: 'mail.example.org:143' }).imap).toEqual({
      host: 'mail.example.org',
      port: 143,
      tls: 'starttls',
    })
    expect(() => configOf({ address: 'nope' })).toThrow()
  })
})

describe('a mailbox, end to end against a server', () => {
  let server: FakeMail
  const secrets = new Map<string, string>()
  const host: Host = {
    secret: (name) => Promise.resolve(secrets.get(name) ?? null),
    keepSecret: (name, value) => {
      if (value === null) secrets.delete(name)
      else secrets.set(name, value)
      return Promise.resolve()
    },
    socket: nodeSocket,
    fetch: globalThis.fetch,
    now: () => Date.UTC(2026, 10, 6, 12),
  }
  const config = () => ({
    address: 'emil@example.org',
    name: 'Emil',
    password: 'right horse',
    imapHost: '127.0.0.1',
    imapPort: String(server.imapPort),
    imapSecurity: 'none',
    smtpHost: '127.0.0.1',
    smtpPort: String(server.smtpPort),
    smtpSecurity: 'none',
  })

  beforeEach(async () => {
    server = new FakeMail()
    await server.listen()
    server.deliver(
      'INBOX',
      [
        'From: Lucile <lucile@example.org>',
        'To: emil@example.org',
        'Cc: Mia <mia@example.org>',
        'Subject: Lunch',
        'Date: Mon, 2 Nov 2026 10:00:00 +0000',
        'Message-ID: <lunch@example.org>',
        '',
        'At noon?',
      ].join('\n'),
    )
    server.deliver(
      'Sent',
      [
        'From: Emil <emil@example.org>',
        'To: Lucile <lucile@example.org>',
        'Subject: Re: Lunch',
        'Date: Mon, 2 Nov 2026 10:05:00 +0000',
        'Message-ID: <answer@example.org>',
        'In-Reply-To: <lunch@example.org>',
        'References: <lunch@example.org>',
        '',
        'Yes!',
        '',
        'On Mon, Lucile wrote:',
        '> At noon?',
      ].join('\n'),
      ['\\Seen'],
    )
    server.deliver(
      'INBOX',
      [
        'From: Shop <news@shop.example>',
        'To: emil@example.org',
        'Subject: =?utf-8?Q?Angebote_f=C3=BCr_dich?=',
        'Date: Tue, 3 Nov 2026 08:00:00 +0000',
        'Message-ID: <news@shop.example>',
        '',
        'Buy',
      ].join('\n'),
    )
  })

  afterEach(async () => {
    await server.close()
  })

  test('lists its conversations by thread, reads one, and answers it', async () => {
    const connection = await mailProvider.connect(config(), host)
    const conversations = await connection.conversations()
    expect(conversations.map((one) => one.title).sort()).toEqual(['Angebote für dich', 'Lunch'])
    const lunch = conversations.find((one) => one.title === 'Lunch')
    expect(lunch).toMatchObject({ id: 'lunch@example.org', kind: 'group', unread: 1 })
    expect(lunch?.people.map((one) => one.handle)).toEqual([
      'lucile@example.org',
      'mia@example.org',
    ])

    const page = await connection.history('lunch@example.org', { limit: 20 })
    expect(page.messages.map((one) => [one.author.handle, one.text, one.mine])).toEqual([
      ['lucile@example.org', 'At noon?', false],
      ['emil@example.org', 'Yes!', true],
    ])

    await connection.markRead?.('lunch@example.org', '')
    expect([...(server.boxes.get('INBOX')?.[0]?.flags ?? [])]).toContain('\\Seen')

    const sent = await connection.send('lunch@example.org', { text: 'See you there' })
    expect(sent).toMatchObject({ mine: true, text: 'See you there' })
    const delivered = server.sent[0]
    expect(delivered?.to).toEqual(['lucile@example.org'])
    const parsed = parseMessage(ascii(delivered?.data ?? ''))
    expect(parsed.headers.get('in-reply-to')).toEqual(['<answer@example.org>'])
    expect(parsed.headers.get('subject')).toEqual(['Re: Lunch'])
    expect(parsed.text).toBe('See you there')
    expect(server.boxes.get('Sent')).toHaveLength(2)
    await connection.close()
  })

  test('hears new mail while it waits, in the thread it answers', async () => {
    const connection = await mailProvider.connect(config(), host)
    const heard: ProviderEvent[] = []
    let online: () => void = () => undefined
    const ready = new Promise<void>((resolve) => (online = resolve))
    let arrived: () => void = () => undefined
    const came = new Promise<void>((resolve) => (arrived = resolve))
    const stop = connection.start((event) => {
      heard.push(event)
      if (event.t === 'status' && event.status === 'online') online()
      if (event.t === 'message') arrived()
    })
    await ready
    await new Promise((resolve) => setTimeout(resolve, 100))
    server.deliver(
      'INBOX',
      [
        'From: Lucile <lucile@example.org>',
        'To: emil@example.org',
        'Subject: Re: Lunch',
        'Date: Mon, 2 Nov 2026 10:10:00 +0000',
        'Message-ID: <late@example.org>',
        'References: <lunch@example.org> <answer@example.org>',
        '',
        'Running late',
      ].join('\n'),
    )
    await came
    expect(heard.find((event) => event.t === 'message')).toMatchObject({
      message: { conversation: 'lunch@example.org', text: 'Running late', mine: false },
    })
    expect(heard.find((event) => event.t === 'conversation')).toMatchObject({
      conversation: { id: 'lunch@example.org', unread: 2 },
    })
    stop()
    await connection.close()
  })

  test('a wrong password is refused, and a kept one is read from the vault', async () => {
    await expect(mailProvider.connect({ ...config(), password: 'wrong' }, host)).rejects.toThrow(
      /Invalid credentials/,
    )
    await host.keepSecret(secretName('mail', 'emil@example.org', 'password'), 'right horse')
    const rest: Record<string, string> = { ...config() }
    delete rest.password
    const connection = await mailProvider.connect(rest, host)
    expect(connection.account.id).toBe('emil@example.org')
    await connection.close()
  })

  test('reads asked at once each come from their own mailbox', async () => {
    const connection = await mailProvider.connect(config(), host)
    const [news, lunch] = await Promise.all([
      connection.history('news@shop.example', { limit: 5 }),
      connection.history('lunch@example.org', { limit: 5 }),
    ])
    expect(news.messages.map((one) => one.text)).toEqual(['Buy'])
    expect(lunch.messages.map((one) => one.text)).toEqual(['At noon?', 'Yes!'])
    await connection.close()
  })

  test('a mail read while another mailbox is being chosen is read from its own', async () => {
    server.deliver(
      'Sent',
      [
        'From: Emil <emil@example.org>',
        'To: Shop <news@shop.example>',
        'Subject: Unsubscribe',
        'Date: Wed, 4 Nov 2026 08:00:00 +0000',
        'Message-ID: <stop@example.org>',
        '',
        'Stop',
      ].join('\n'),
    )
    const connection = await mailProvider.connect(config(), host)
    await connection.history('lunch@example.org', { limit: 1 })
    const [, stop] = await Promise.all([
      connection.markRead?.('news@shop.example', ''),
      connection.history('stop@example.org', { limit: 5 }),
    ])
    expect(stop.messages.map((one) => one.text)).toEqual(['Stop'])
    expect([...(server.boxes.get('INBOX')?.[1]?.flags ?? [])]).toContain('\\Seen')
    expect([...(server.boxes.get('Sent')?.[1]?.flags ?? [])]).not.toContain('\\Seen')
    await connection.close()
  })

  test('the files of a mail, by their place in it', async () => {
    server.deliver(
      'INBOX',
      [
        'From: Lucile <lucile@example.org>',
        'To: emil@example.org',
        'Subject: Slides',
        'Date: Wed, 4 Nov 2026 08:00:00 +0000',
        'Message-ID: <slides@example.org>',
        'Content-Type: multipart/mixed; boundary=b',
        '',
        '--b',
        'Content-Type: text/plain',
        '',
        'Here',
        '--b',
        'Content-Type: image/png; name=a.png',
        'Content-Transfer-Encoding: base64',
        '',
        'iVBORw0KGgo=',
        '--b--',
      ].join('\n'),
    )
    const connection = await mailProvider.connect(config(), host)
    const page = await connection.history('slides@example.org', { limit: 5 })
    const file = page.messages[0]?.attachments[0]
    expect(file).toMatchObject({ name: 'a.png', type: 'image/png', ref: '2' })
    const bytes = await connection.attachment('slides@example.org', page.messages[0]?.id ?? '', '2')
    expect(bytes).toEqual(fromBase64('iVBORw0KGgo='))
    await connection.close()
  })
})
