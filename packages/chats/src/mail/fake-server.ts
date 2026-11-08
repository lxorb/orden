import { createServer, type Server, Socket as NodeSocket } from 'node:net'
import type { Socket, SocketAsk } from '../provider'
import { fromBase64, fromLatin, latin, Reader } from './bytes'
import { addressesOf, headersOf } from './mime'

export interface Stored {
  uid: number
  flags: Set<string>
  raw: Uint8Array
}

export class FakeMail {
  boxes = new Map<string, Stored[]>([
    ['INBOX', []],
    ['Sent', []],
  ])
  next = new Map<string, number>()
  validity = new Map<string, number>()
  sent: { from: string; to: string[]; data: string }[] = []
  user = 'emil@example.org'
  password = 'right horse'
  idle = true
  sasl = true
  bearer = false
  tokens = new Set<string>()
  bearers: string[] = []
  private readonly idlers = new Set<() => void>()
  private readonly servers: Server[] = []
  private readonly sockets = new Set<NodeSocket>()
  imapPort = 0
  smtpPort = 0

  deliver(box: string, raw: string, flags: string[] = []): number {
    const list = this.boxes.get(box) ?? []
    const uid = (this.next.get(box) ?? 0) + 1
    this.next.set(box, uid)
    list.push({ uid, flags: new Set(flags), raw: fromLatin(raw.replace(/\r?\n/g, '\r\n')) })
    this.boxes.set(box, list)
    for (const wake of this.idlers) wake()
    return uid
  }

  private wake(): void {
    for (const wake of this.idlers) wake()
  }

  mark(box: string, uid: number, flag: string): void {
    this.boxes
      .get(box)
      ?.find((one) => one.uid === uid)
      ?.flags.add(flag)
    this.wake()
  }

  expunge(box: string, uid: number): void {
    this.boxes.set(
      box,
      (this.boxes.get(box) ?? []).filter((one) => one.uid !== uid),
    )
    this.wake()
  }

  rebuild(box: string): void {
    const list = [...(this.boxes.get(box) ?? [])].reverse()
    list.forEach((one, at) => (one.uid = at + 1))
    this.boxes.set(box, list)
    this.next.set(box, list.length)
    this.validity.set(box, (this.validity.get(box) ?? 1) + 1)
    this.wake()
  }

  private signedInWith(said: string): boolean {
    const parts = new TextDecoder().decode(fromBase64(said)).split('\x01')
    const user = parts[0]?.replace(/^user=/, '')
    const token = parts[1]?.replace(/^auth=Bearer /, '') ?? ''
    this.bearers.push(token)
    return this.bearer && user === this.user && this.tokens.has(token)
  }

  async listen(): Promise<void> {
    const listen = (handle: (socket: NodeSocket) => void) =>
      new Promise<number>((resolve) => {
        const server = createServer((socket) => {
          this.sockets.add(socket)
          socket.on('close', () => this.sockets.delete(socket))
          handle(socket)
        })
        this.servers.push(server)
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          resolve(typeof address === 'object' && address ? address.port : 0)
        })
      })
    this.imapPort = await listen((socket) => this.imap(socket))
    this.smtpPort = await listen((socket) => this.smtp(socket))
  }

  async close(): Promise<void> {
    await Promise.all(
      this.servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
            for (const socket of this.sockets) socket.destroy()
          }),
      ),
    )
  }

  private imap(socket: NodeSocket): void {
    socket.on('error', () => undefined)
    const reader = new Reader()
    const say = (line: string) => socket.write(fromLatin(`${line}\r\n`))
    let box: string | null = null
    let told = ''
    const state = () =>
      (this.boxes.get(box ?? '') ?? []).map((one) => `${one.uid}${[...one.flags].join()}`).join(' ')
    let authed = false
    let literal: { tag: string; rest: string; size: number } | null = null
    let idling: { tag: string; stop: () => void } | null = null
    let sasl: { tag: string; failed: boolean } | null = null
    const caps = `IMAP4rev1 LITERAL+${this.sasl ? ' AUTH=PLAIN SASL-IR' : ''}${this.bearer ? ' AUTH=XOAUTH2' : ''}${this.idle ? ' IDLE' : ''}`
    say(`* OK [CAPABILITY ${caps}] fake ready`)

    const messages = () => this.boxes.get(box ?? '') ?? []
    const tokenSaid = (tag: string, said: string) => {
      if (this.signedInWith(said)) {
        authed = true
        say(`${tag} OK in`)
        return
      }
      sasl = { tag, failed: true }
      say(`+ ${FAILED}`)
    }
    const handle = (line: string, data?: Uint8Array) => {
      if (sasl) {
        const held = sasl
        sasl = null
        if (held.failed) say(`${held.tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`)
        else tokenSaid(held.tag, line)
        return
      }
      if (idling) {
        if (line.toUpperCase() === 'DONE') {
          idling.stop()
          say(`${idling.tag} OK idle done`)
          idling = null
        }
        return
      }
      const found = /^(\S+) (UID )?([A-Za-z]+) ?(.*)$/.exec(line)
      if (!found) return
      const tag = found[1] ?? ''
      const uid = !!found[2]
      const command = (found[3] ?? '').toUpperCase()
      const rest = found[4] ?? ''
      if (command === 'CAPABILITY') {
        say(`* CAPABILITY ${caps}`)
        say(`${tag} OK done`)
      } else if (command === 'LOGIN') {
        if (/[\u0080-\uffff]/.test(rest)) {
          say(`${tag} BAD 8-bit characters in a quoted string`)
          return
        }
        const said = [...rest.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((one) =>
          (one[1] ?? '').replace(/\\(.)/g, '$1'),
        )
        const user = said[0]
        const password = data ? new TextDecoder().decode(data) : said[1]
        authed = user === this.user && password === this.password
        say(authed ? `${tag} OK in` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`)
      } else if (command === 'AUTHENTICATE' && /^XOAUTH2\b/i.test(rest)) {
        const said = rest.split(' ')[1]
        if (said) tokenSaid(tag, said)
        else {
          sasl = { tag, failed: false }
          say('+ ')
        }
      } else if (command === 'AUTHENTICATE') {
        const [, user, password] = new TextDecoder()
          .decode(fromBase64(rest.split(' ')[1] ?? ''))
          .split('\0')
        authed = user === this.user && password === this.password
        say(authed ? `${tag} OK in` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`)
      } else if (!authed && command !== 'LOGOUT') {
        say(`${tag} BAD not authenticated`)
      } else if (command === 'LIST') {
        say('* LIST (\\HasNoChildren) "/" "INBOX"')
        say('* LIST (\\HasNoChildren \\Sent) "/" "Sent"')
        say(`${tag} OK listed`)
      } else if (command === 'SELECT') {
        box = rest.replace(/^"|"$/g, '')
        told = state()
        say(`* ${messages().length} EXISTS`)
        say(`* OK [UIDVALIDITY ${this.validity.get(box) ?? 1}] valid`)
        say(`* OK [UIDNEXT ${(this.next.get(box) ?? 0) + 1}] next`)
        say(`${tag} OK [READ-WRITE] selected`)
      } else if (command === 'FETCH') {
        const [range = '', ...what] = rest.split(' ')
        const wanted = what.join(' ').toUpperCase()
        const list = messages()
        const chosen = list.filter((one, at) => inRange(range, uid ? one.uid : at + 1, uid, list))
        for (const one of chosen) {
          const seq = list.indexOf(one) + 1
          const parts = [`UID ${one.uid}`, `FLAGS (${[...one.flags].join(' ')})`]
          if (wanted.includes('ENVELOPE')) parts.push(`ENVELOPE ${envelope(one.raw)}`)
          if (wanted.includes('HEADER.FIELDS')) {
            const references = headersOf(latin(one.raw)).get('references')?.[0]
            const block = references ? `References: ${references}\r\n\r\n` : '\r\n'
            parts.push(`BODY[HEADER.FIELDS (REFERENCES)] {${block.length}}\r\n${block}`)
          }
          if (wanted.includes('BODY.PEEK[]')) {
            parts.push(`BODY[] {${one.raw.length}}\r\n${latin(one.raw)}`)
          }
          socket.write(fromLatin(`* ${seq} FETCH (${parts.join(' ')})\r\n`))
        }
        say(`${tag} OK fetched`)
      } else if (command === 'STORE') {
        const [range = ''] = rest.split(' ')
        const list = messages()
        for (const one of list.filter((it) => inRange(range, it.uid, true, list))) {
          if (/\\Seen/i.test(rest)) one.flags.add('\\Seen')
        }
        say(`${tag} OK stored`)
      } else if (command === 'APPEND') {
        const name = /^"([^"]*)"/.exec(rest)?.[1] ?? ''
        if (data) {
          this.deliver(name, latin(data), ['\\Seen'])
          say(`${tag} OK appended`)
        }
      } else if (command === 'IDLE') {
        const wake = () => {
          told = state()
          say(`* ${messages().length} EXISTS`)
        }
        this.idlers.add(wake)
        idling = { tag, stop: () => this.idlers.delete(wake) }
        say('+ idling')
        if (state() !== told) wake()
      } else if (command === 'NOOP') {
        say(`${tag} OK noop`)
      } else if (command === 'LOGOUT') {
        say('* BYE')
        say(`${tag} OK bye`)
        socket.end()
      } else {
        say(`${tag} BAD unknown`)
      }
    }

    socket.on('close', () => idling?.stop())
    socket.on('data', (chunk: Buffer) => {
      reader.push(new Uint8Array(chunk))
      for (;;) {
        if (literal) {
          const data = reader.take(literal.size)
          if (!data) return
          const held = literal
          literal = null
          reader.line()
          handle(`${held.tag}${held.rest}`, data)
          continue
        }
        const line = reader.line()
        if (line === null) return
        const size = /\{(\d+)\+?\}$/.exec(line)
        if (size) {
          literal = { tag: '', rest: line.slice(0, size.index).trimEnd(), size: Number(size[1]) }
          if (!line.includes('+}')) say('+ go on')
          continue
        }
        handle(line)
      }
    })
  }

  private smtp(socket: NodeSocket): void {
    socket.on('error', () => undefined)
    const reader = new Reader()
    const say = (line: string) => socket.write(fromLatin(`${line}\r\n`))
    let from = ''
    let to: string[] = []
    let data: string[] | null = null
    let refused = false
    say('220 fake ESMTP')
    socket.on('data', (chunk: Buffer) => {
      reader.push(new Uint8Array(chunk))
      for (let line = reader.line(); line !== null; line = reader.line()) {
        if (data) {
          if (line === '.') {
            this.sent.push({ from, to, data: data.join('\r\n') })
            data = null
            say('250 queued')
          } else data.push(line.startsWith('..') ? line.slice(1) : line)
          continue
        }
        if (refused) {
          refused = false
          say('535 5.7.8 Username and Password not accepted')
          continue
        }
        const upper = line.toUpperCase()
        if (upper.startsWith('EHLO')) {
          say('250-fake')
          say(`250-AUTH PLAIN LOGIN${this.bearer ? ' XOAUTH2' : ''}`)
          say('250 8BITMIME')
        } else if (upper.startsWith('AUTH XOAUTH2 ')) {
          if (this.signedInWith(line.split(' ')[2] ?? '')) say('235 ok')
          else {
            refused = true
            say(`334 ${FAILED}`)
          }
        } else if (upper.startsWith('AUTH PLAIN')) {
          const [, user, password] = new TextDecoder()
            .decode(fromBase64(line.split(' ')[2] ?? ''))
            .split('\0')
          say(user === this.user && password === this.password ? '235 ok' : '535 no')
        } else if (upper.startsWith('MAIL FROM:')) {
          from = /<([^>]*)>/.exec(line)?.[1] ?? ''
          to = []
          say('250 ok')
        } else if (upper.startsWith('RCPT TO:')) {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? '')
          say('250 ok')
        } else if (upper === 'DATA') {
          data = []
          say('354 go on')
        } else if (upper === 'QUIT') {
          say('221 bye')
          socket.end()
        } else say('502 no')
      }
    })
  }
}

const FAILED = 'eyJzdGF0dXMiOiI0MDAiLCJzY2hlbWVzIjoiQmVhcmVyIn0='

function inRange(range: string, at: number, uid: boolean, list: readonly Stored[]): boolean {
  const top = uid ? (list.at(-1)?.uid ?? 0) : list.length
  return range.split(',').some((piece) => {
    const [a = '', b] = piece.split(':')
    const low = a === '*' ? top : Number(a)
    const high = b === undefined ? low : b === '*' ? top : Number(b)
    return at >= Math.min(low, high) && at <= Math.max(low, high)
  })
}

function envelope(raw: Uint8Array): string {
  const headers = headersOf(latin(raw))
  const one = (name: string) => headers.get(name)?.[0]
  const q = (value: string | undefined) =>
    value === undefined
      ? 'NIL'
      : `"${latin(new TextEncoder().encode(value)).replace(/[\\"]/g, (char) => `\\${char}`)}"`
  const people = (name: string) => {
    const list = addressesOf(one(name) ?? '')
    if (!list.length) return 'NIL'
    return `(${list
      .map((it) => {
        const [mailbox, host] = it.address.split('@')
        return `(${q(it.name || undefined)} NIL ${q(mailbox)} ${q(host)})`
      })
      .join('')})`
  }
  return `(${q(one('date'))} ${q(one('subject'))} ${people('from')} ${people('from')} ${people(one('reply-to') ? 'reply-to' : 'from')} ${people('to')} ${people('cc')} NIL ${q(one('in-reply-to'))} ${q(one('message-id'))})`
}

export function nodeSocket(ask: SocketAsk): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new NodeSocket()
    socket.once('error', reject)
    socket.connect(ask.port, ask.host, () => {
      socket.off('error', reject)
      socket.on('error', () => undefined)
      resolve({
        write: (bytes) =>
          new Promise((done, failed) =>
            socket.write(bytes, (error) => (error ? failed(error) : done())),
          ),
        read: (hear, end) => {
          const data = (chunk: Buffer) => hear(new Uint8Array(chunk))
          const closed = () => end()
          socket.on('data', data)
          socket.on('close', closed)
          return () => {
            socket.off('data', data)
            socket.off('close', closed)
          }
        },
        startTls: () => Promise.reject(new Error('plain only')),
        close: () => {
          socket.destroy()
          return Promise.resolve()
        },
      })
    })
  })
}
