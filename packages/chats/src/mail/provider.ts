import type {
  ChatProvider,
  Connection,
  Conversation,
  Host,
  Outgoing,
  Person,
  ProviderEvent,
  ProviderMessage,
  Socket,
  SocketAsk,
  Status,
} from '../provider'
import { secretName } from '../provider'
import { bytesOf, Imap, itemsOf, quoted, textOf, type Untagged, type Value } from './imap'
import {
  type Address,
  buildMessage,
  decodeWords,
  headersOf,
  idsOf,
  parseMessage,
  withoutQuote,
} from './mime'
import { sendMail } from './smtp'
import { bareSubject, threadsOf } from './threads'

const NEWEST = 300
const LOOK_EVERY = 60_000
const IDLE_FOR = 25 * 60_000

export const MAIL = 'mail'

interface Mail {
  key: string
  box: string
  uid: number
  id: string
  links: string[]
  subject: string
  from: Address[]
  to: Address[]
  cc: Address[]
  at: number
  seen: boolean
  mine: boolean
}

interface Read {
  text: string
  attachments: { ref: string; name: string; type: string; size: number; bytes: Uint8Array }[]
}

export interface MailConfig {
  address: string
  name: string
  user: string
  password: string
  imap: SocketAsk
  smtp: SocketAsk
}

type Security = SocketAsk['tls']

const PRESETS: Record<string, { imap: string; smtp: string; smtpPort?: number }> = {
  'gmail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'googlemail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'outlook.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', smtpPort: 587 },
  'hotmail.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', smtpPort: 587 },
  'icloud.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587 },
  'me.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587 },
  'fastmail.com': { imap: 'imap.fastmail.com', smtp: 'smtp.fastmail.com' },
  'gmx.net': { imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  'gmx.de': { imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  'gmx.ch': { imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  'web.de': { imap: 'imap.web.de', smtp: 'smtp.web.de', smtpPort: 587 },
  'posteo.de': { imap: 'posteo.de', smtp: 'posteo.de' },
  'yahoo.com': { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
}

export function guessServers(address: string): {
  imapHost: string
  imapPort: string
  smtpHost: string
  smtpPort: string
} {
  const domain = address.split('@')[1]?.trim().toLowerCase() ?? ''
  const preset = PRESETS[domain]
  return {
    imapHost: preset?.imap ?? (domain ? `imap.${domain}` : ''),
    imapPort: '993',
    smtpHost: preset?.smtp ?? (domain ? `smtp.${domain}` : ''),
    smtpPort: String(preset?.smtpPort ?? 465),
  }
}

function securityOf(value: string | undefined, port: number): Security {
  if (value === 'tls' || value === 'starttls' || value === 'none') return value
  return port === 993 || port === 465 ? 'tls' : 'starttls'
}

function hostAndPort(value: string | undefined): { host?: string; port?: string } {
  const found = /^\s*([^\s:]+)(?::(\d+))?\s*$/.exec(value ?? '')
  if (!found?.[1]) return {}
  return { host: found[1], ...(found[2] ? { port: found[2] } : {}) }
}

export function configOf(values: Readonly<Record<string, string>>): MailConfig {
  const address = (values.address ?? '').trim()
  const guessed = guessServers(address)
  const imap = hostAndPort(values.imapHost)
  const smtp = hostAndPort(values.smtpHost)
  const imapPort = Number(filled(values.imapPort) ?? imap.port ?? guessed.imapPort)
  const smtpPort = Number(filled(values.smtpPort) ?? smtp.port ?? guessed.smtpPort)
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) throw new Error('that is not a mail address')
  return {
    address,
    name: (values.name ?? '').trim(),
    user: (values.user ?? '').trim() || address,
    password: values.password ?? '',
    imap: {
      host: imap.host ?? guessed.imapHost,
      port: imapPort,
      tls: securityOf(values.imapSecurity, imapPort),
    },
    smtp: {
      host: smtp.host ?? guessed.smtpHost,
      port: smtpPort,
      tls: securityOf(values.smtpSecurity, smtpPort),
    },
  }
}

const filled = (value: string | undefined): string | undefined =>
  value?.trim() ? value.trim() : undefined

const text = textOf

function addressList(value: Value | undefined): Address[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((one) => {
    if (!Array.isArray(one)) return []
    const mailbox = text(one[2])
    const host = text(one[3])
    if (!mailbox || !host) return []
    return [{ name: decodeWords(text(one[0])), address: `${mailbox}@${host}`.toLowerCase() }]
  })
}

function personOf(one: Address): Person {
  return { id: one.address, name: one.name || one.address, handle: one.address }
}

class MailConnection {
  readonly account
  private readonly mails = new Map<string, Mail>()
  private readonly bodies = new Map<string, Read>()
  private main: Imap | null = null
  private opening: Promise<Imap> | null = null
  private selected: string | null = null
  private turn: Promise<unknown> = Promise.resolve()
  private sent: string | null = null
  private readonly last = new Map<string, number>()
  private readonly hearers = new Set<(event: ProviderEvent) => void>()
  private watching = false
  private stopped = false
  private status: Status = 'connecting'

  constructor(
    private readonly config: MailConfig,
    private readonly host: Host,
    private readonly open: (ask: SocketAsk) => Promise<Socket>,
  ) {
    this.account = { id: config.address.toLowerCase(), label: config.address }
  }

  private connect(): Promise<Imap> {
    if (this.main?.alive()) return Promise.resolve(this.main)
    this.opening ??= Imap.open(this.open, this.config.imap, this.config.user, this.config.password)
      .then((imap) => {
        this.main = imap
        this.selected = null
        imap.ended = () => {
          if (this.main === imap) this.main = null
        }
        return imap
      })
      .finally(() => (this.opening = null))
    return this.opening
  }

  private held<T>(run: (imap: Imap) => Promise<T>): Promise<T> {
    const turn = this.turn.then(async () => run(await this.connect()))
    this.turn = turn.catch(() => undefined)
    return turn
  }

  private inBox<T>(box: string, run: (imap: Imap) => Promise<T>): Promise<T> {
    return this.held(async (imap) => {
      if (this.selected !== box) await this.select(box, imap)
      return run(imap)
    })
  }

  private async select(box: string, imap?: Imap): Promise<{ imap: Imap; exists: number }> {
    const held = imap ?? (await this.connect())
    const lines = await held.command(`SELECT ${quoted(box)}`)
    if (held === this.main) this.selected = box
    const exists = lines.find((one) => one.kind === 'EXISTS')?.number ?? 0
    return { imap: held, exists }
  }

  begin(): Promise<void> {
    return this.held(async (imap) => {
      const boxes = await imap.command('LIST "" "*"')
      this.sent = sentBox(boxes)
      for (const box of ['INBOX', ...(this.sent ? [this.sent] : [])]) {
        const { exists } = await this.select(box, imap)
        if (exists) await this.fetch(imap, box, `${Math.max(1, exists - NEWEST + 1)}:*`, false)
      }
    })
  }

  private async fetch(imap: Imap, box: string, range: string, byUid: boolean): Promise<Mail[]> {
    const lines = await imap.command(
      `${byUid ? 'UID ' : ''}FETCH ${range} (UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (REFERENCES)])`,
    )
    const found: Mail[] = []
    for (const line of lines) {
      const mail = this.mailOf(box, line)
      if (!mail || this.mails.has(mail.key)) continue
      this.mails.set(mail.key, mail)
      this.last.set(box, Math.max(this.last.get(box) ?? 0, mail.uid))
      found.push(mail)
    }
    return found
  }

  private mailOf(box: string, line: Untagged): Mail | null {
    if (line.kind !== 'FETCH') return null
    const items = itemsOf(line.values)
    const uid = Number(text(items.get('UID')))
    const envelope = items.get('ENVELOPE')
    if (!uid || !Array.isArray(envelope)) return null
    const flags = items.get('FLAGS')
    const seen = Array.isArray(flags) && flags.some((one) => text(one).toLowerCase() === '\\seen')
    const references = [...items.entries()].find(([key]) => key.startsWith('BODY['))?.[1]
    const header = headersOf(text(references))
    const from = addressList(envelope[2])
    const key = `${box}\n${uid}`
    const id = idsOf(text(envelope[9]))[0] ?? key
    const at = Date.parse(text(envelope[0]))
    const me = this.config.address.toLowerCase()
    return {
      key,
      box,
      uid,
      id,
      links: [...idsOf(header.get('references')?.join(' ')), ...idsOf(text(envelope[8]))],
      subject: decodeWords(text(envelope[1])),
      from,
      to: addressList(envelope[5]),
      cc: addressList(envelope[6]),
      at: Number.isFinite(at) ? at : this.host.now(),
      seen,
      mine: box === this.sent || from.some((one) => one.address === me),
    }
  }

  private threads(): Map<string, string> {
    return threadsOf([...this.mails.values()])
  }

  private conversationList(): Conversation[] {
    const threads = this.threads()
    const groups = new Map<string, Mail[]>()
    for (const mail of this.mails.values()) {
      const thread = threads.get(mail.key) ?? mail.id
      const list = groups.get(thread) ?? []
      list.push(mail)
      groups.set(thread, list)
    }
    return [...groups.entries()].map(([id, list]) => this.conversationOf(id, list))
  }

  private conversationOf(id: string, list: readonly Mail[]): Conversation {
    const sorted = [...list].sort((a, b) => a.at - b.at)
    const me = this.config.address.toLowerCase()
    const people = new Map<string, Address>()
    for (const mail of sorted) {
      for (const one of [...mail.from, ...mail.to, ...mail.cc]) {
        if (one.address !== me && !people.has(one.address)) people.set(one.address, one)
      }
    }
    const newest = sorted.at(-1)
    return {
      id,
      title: bareSubject(sorted[0]?.subject ?? '') || null,
      kind: people.size > 1 ? 'group' : 'direct',
      people: [...people.values()].map(personOf),
      lastAt: newest?.at ?? null,
      unread: sorted.filter((mail) => !mail.seen && !mail.mine).length,
      snippet: filled(newest?.from[0]?.name) ?? newest?.from[0]?.address ?? '',
    }
  }

  private inThread(conversation: string): Mail[] {
    const threads = this.threads()
    return [...this.mails.values()]
      .filter((mail) => (threads.get(mail.key) ?? mail.id) === conversation)
      .sort((a, b) => a.at - b.at)
  }

  conversations(): Promise<Conversation[]> {
    return Promise.resolve(this.conversationList())
  }

  private async body(mail: Mail): Promise<Read> {
    const held = this.bodies.get(mail.key)
    if (held) return held
    const lines = await this.inBox(mail.box, (imap) =>
      imap.command(`UID FETCH ${mail.uid} (BODY.PEEK[])`),
    )
    const line = lines.find(
      (one) => one.kind === 'FETCH' && Number(text(itemsOf(one.values).get('UID'))) === mail.uid,
    )
    const items = line ? itemsOf(line.values) : new Map<string, Value>()
    const raw = bytesOf(items.get('BODY[]') ?? undefined)
    const parsed = this.host.parseMessage
      ? await this.host.parseMessage(raw).catch(() => parseMessage(raw))
      : parseMessage(raw)
    const read: Read = {
      text: withoutQuote(parsed.text),
      attachments: parsed.attachments.map((part) => ({
        ref: part.path,
        name: part.filename ?? part.type,
        type: part.type,
        size: part.bytes.length,
        bytes: part.bytes,
      })),
    }
    this.bodies.set(mail.key, read)
    return read
  }

  private async messageOf(conversation: string, mail: Mail): Promise<ProviderMessage> {
    const read = await this.body(mail)
    const author = mail.from[0] ?? { name: '', address: '' }
    return {
      id: mail.key,
      conversation,
      author: personOf(author),
      at: mail.at,
      text: read.text,
      subject: mail.subject,
      attachments: read.attachments.map(({ ref, name, type, size }) => ({ ref, name, type, size })),
      mine: mail.mine,
    }
  }

  async history(conversation: string, ask: { limit: number; before?: string }) {
    const all = this.inThread(conversation)
    const end = ask.before === undefined ? all.length : Number(ask.before)
    const start = Math.max(0, end - Math.max(1, ask.limit))
    const messages: ProviderMessage[] = []
    for (const mail of all.slice(start, end))
      messages.push(await this.messageOf(conversation, mail))
    return { messages, before: start > 0 ? String(start) : null }
  }

  async send(conversation: string, draft: Outgoing): Promise<ProviderMessage> {
    const thread = this.inThread(conversation)
    const last = thread.at(-1)
    if (!last) throw new Error('there is no mail to answer')
    const me = this.config.address.toLowerCase()
    const others = (list: readonly Address[]) => list.filter((one) => one.address !== me)
    const to = last.mine ? others(last.to) : others(last.from)
    const cc = last.mine ? others(last.cc) : others([...last.to, ...last.cc])
    const recipients = [...to, ...cc].filter(
      (one, at, all) => all.findIndex((it) => it.address === one.address) === at,
    )
    if (!recipients.length) throw new Error('nobody to send it to')
    const subject = /^\s*re\s*:/i.test(last.subject)
      ? last.subject
      : `Re: ${bareSubject(last.subject)}`
    const domain = me.split('@')[1] ?? 'orden.local'
    const messageId = `${this.host.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@${domain}`
    const message = buildMessage({
      from: { name: this.config.name, address: this.config.address },
      to: to.length ? to : recipients,
      cc: to.length ? cc.filter((one) => !to.some((it) => it.address === one.address)) : [],
      subject,
      text: draft.text,
      messageId,
      ...(last.id.includes('@') ? { inReplyTo: last.id } : {}),
      references: [...last.links, ...(last.id.includes('@') ? [last.id] : [])].slice(-20),
      date: new Date(this.host.now()),
      ...(draft.attachments?.length ? { attachments: draft.attachments } : {}),
    })
    await sendMail(
      this.open,
      this.config.smtp,
      { user: this.config.user, password: this.config.password },
      { from: this.config.address, to: recipients.map((one) => one.address) },
      message,
    )
    const box = this.sent
    if (box && !/gmail|googlemail/i.test(this.config.smtp.host)) {
      const imap = await this.connect().catch(() => null)
      await imap?.command(`APPEND ${quoted(box)} (\\Seen)`, message).catch(() => undefined)
    }
    const key = `sent\n${messageId}`
    const mail: Mail = {
      key,
      box: box ?? '',
      uid: 0,
      id: messageId,
      links: [...last.links, last.id],
      subject,
      from: [{ name: this.config.name, address: me }],
      to,
      cc,
      at: this.host.now(),
      seen: true,
      mine: true,
    }
    this.mails.set(key, mail)
    this.bodies.set(key, {
      text: draft.text,
      attachments: (draft.attachments ?? []).map((one, at) => ({
        ref: String(at + 2),
        name: one.name,
        type: one.type,
        size: one.bytes.length,
        bytes: one.bytes,
      })),
    })
    const sentMessage = await this.messageOf(conversation, mail)
    this.tell({ t: 'message', message: sentMessage })
    return sentMessage
  }

  async attachment(conversation: string, message: string, ref: string): Promise<Uint8Array> {
    const mail = this.inThread(conversation).find((one) => one.key === message)
    if (!mail) throw new Error('that mail is not here')
    const found = (await this.body(mail)).attachments.find((one) => one.ref === ref)
    if (!found) throw new Error('that file is not in the mail')
    return found.bytes
  }

  async markRead(conversation: string): Promise<void> {
    const unseen = this.inThread(conversation).filter((mail) => !mail.seen && mail.uid)
    if (!unseen.length) return
    for (const box of new Set(unseen.map((mail) => mail.box))) {
      const uids = unseen.filter((mail) => mail.box === box).map((mail) => mail.uid)
      await this.inBox(box, (imap) =>
        imap.command(`UID STORE ${uids.join(',')} +FLAGS.SILENT (\\Seen)`),
      )
    }
    for (const mail of unseen) mail.seen = true
    const list = this.inThread(conversation)
    this.tell({ t: 'conversation', conversation: this.conversationOf(conversation, list) })
  }

  private tell(event: ProviderEvent): void {
    if (event.t === 'status') this.status = event.status
    for (const hear of this.hearers) hear(event)
  }

  private async look(): Promise<void> {
    const after = (this.last.get('INBOX') ?? 0) + 1
    const found = (
      await this.held(async (imap) => {
        await this.select('INBOX', imap)
        return this.fetch(imap, 'INBOX', `${after}:*`, true)
      })
    ).filter((mail) => mail.uid >= after)
    if (!found.length) return
    const threads = this.threads()
    const touched = new Set<string>()
    for (const mail of found) {
      const conversation = threads.get(mail.key) ?? mail.id
      touched.add(conversation)
      this.tell({ t: 'message', message: await this.messageOf(conversation, mail) })
    }
    for (const conversation of touched) {
      this.tell({
        t: 'conversation',
        conversation: this.conversationOf(conversation, this.inThread(conversation)),
      })
    }
  }

  private async watch(): Promise<void> {
    let wait = 5_000
    while (!this.stopped) {
      try {
        const imap = await Imap.open(
          this.open,
          this.config.imap,
          this.config.user,
          this.config.password,
        )
        if (this.status !== 'online') this.tell({ t: 'status', status: 'online' })
        wait = 5_000
        await this.select('INBOX', imap)
        await this.look()
        await this.follow(imap)
        await imap.close()
      } catch (error) {
        if (this.halted()) return
        const reason = error instanceof Error ? error.message : String(error)
        const refused = /auth|login|password|credential|invalid/i.test(reason)
        this.tell({ t: 'status', status: refused ? 'signed-out' : 'offline', reason })
        if (refused) return
        await new Promise((resolve) => setTimeout(resolve, wait))
        wait = Math.min(wait * 2, 300_000)
      }
    }
  }

  private async follow(imap: Imap): Promise<void> {
    while (!this.stopped && imap.alive()) {
      if (!imap.capabilities.has('IDLE')) {
        await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY))
        await imap.command('NOOP')
        await this.look()
        continue
      }
      let wake: () => void = () => undefined
      const woken = new Promise<void>((resolve) => (wake = resolve))
      imap.hear = (one) => {
        if (one.kind === 'EXISTS' || one.kind === 'EXPUNGE' || one.kind === 'FETCH') wake()
      }
      imap.ended = () => wake()
      const done = await imap.idle()
      const timer = setTimeout(wake, IDLE_FOR)
      this.wakeIdle = wake
      await woken
      clearTimeout(timer)
      await done()
      if (this.halted() || !imap.alive()) return
      await this.look()
    }
  }

  private wakeIdle: () => void = () => undefined

  private halted(): boolean {
    return this.stopped
  }

  hear(hear: (event: ProviderEvent) => void): () => void {
    this.hearers.add(hear)
    if (!this.watching) {
      this.watching = true
      void this.watch()
    }
    return () => this.hearers.delete(hear)
  }

  async close(): Promise<void> {
    this.stopped = true
    this.wakeIdle()
    await this.main?.close()
    this.main = null
  }
}

export function sentBox(lines: readonly Untagged[]): string | null {
  const boxes = lines
    .filter((one) => one.kind === 'LIST')
    .map((one) => ({
      flags: Array.isArray(one.values[0]) ? one.values[0].map((it) => text(it).toLowerCase()) : [],
      name: text(one.values[2]),
    }))
  const marked = boxes.find((box) => box.flags.includes('\\sent'))
  if (marked) return marked.name
  const named =
    /^(inbox[./])?(sent|sent items|sent messages|sent mail|gesendet|gesendete objekte|envoyés|enviados)$/i
  return boxes.find((box) => named.test(box.name))?.name ?? null
}

export const mailProvider: ChatProvider = {
  id: MAIL,
  name: 'Email',
  icon: 'M22 7l-8.99 5.73a2 2 0 0 1-2.02 0L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  fields: [
    { key: 'address', label: 'Email address', kind: 'email' },
    { key: 'password', label: 'Password', kind: 'password', secret: true },
    { key: 'name', label: 'Your name', kind: 'text', optional: true },
    { key: 'imapHost', label: 'IMAP server', kind: 'text', optional: true },
    { key: 'smtpHost', label: 'SMTP server', kind: 'text', optional: true },
    { key: 'user', label: 'User name', kind: 'text', optional: true },
  ],
  can: { send: true, attachments: true, live: true, replies: false },
  available: (host) => !!host.socket,
  async connect(values, host) {
    const open = host.socket
    if (!open) throw new Error('mail needs the desktop app')
    const config = configOf(values)
    if (!config.password) {
      config.password = (await host.secret(secretName(MAIL, config.address, 'password'))) ?? ''
    }
    const connection = new MailConnection(config, host, open)
    await connection.begin()
    const live: Connection = {
      account: connection.account,
      conversations: () => connection.conversations(),
      history: (conversation, ask) => connection.history(conversation, ask),
      send: (conversation, draft) => connection.send(conversation, draft),
      start: (hear) => connection.hear(hear),
      attachment: (conversation, message, ref) => connection.attachment(conversation, message, ref),
      markRead: (conversation) => connection.markRead(conversation),
      close: () => connection.close(),
    }
    return live
  },
}
