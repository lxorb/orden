import type { Socket, SocketAsk } from '../provider'
import { ascii, concat, fromLatin, latin, Reader, toBase64 } from './bytes'

export type Value = string | null | Uint8Array | Value[]

export interface Untagged {
  kind: string
  number?: number
  values: Value[]
  line: string
}

export function parseValues(
  text: string,
  literals: ReadonlyMap<number, Uint8Array> = new Map(),
  base = 0,
): Value[] {
  let at = 0
  const list = (): Value[] => {
    const out: Value[] = []
    while (at < text.length) {
      const char = text[at]
      if (char === ' ') {
        at++
      } else if (char === ')') {
        at++
        return out
      } else if (char === '(') {
        at++
        out.push(list())
      } else if (char === '"') {
        at++
        let value = ''
        while (at < text.length && text[at] !== '"') {
          if (text[at] === '\\') at++
          value += text[at] ?? ''
          at++
        }
        at++
        out.push(value)
      } else if (char === '{' && /^\{\d+\+?\}/.test(text.slice(at))) {
        const close = text.indexOf('}', at)
        const count = Number.parseInt(text.slice(at + 1, close), 10)
        at = close + 1
        const held = literals.get(base + at)
        if (held) {
          out.push(held)
        } else {
          out.push(text.slice(at, at + count))
          at += count
        }
      } else {
        let value = ''
        while (at < text.length && !' ()'.includes(text[at] ?? ' ')) {
          if (text[at] === '[') {
            const close = text.indexOf(']', at)
            const end = close < 0 ? text.length : close + 1
            value += text.slice(at, end)
            at = end
          } else {
            value += text.charAt(at)
            at++
          }
        }
        out.push(value.toUpperCase() === 'NIL' ? null : value)
      }
    }
    return out
  }
  return list()
}

export function untaggedOf(
  text: string,
  literals: ReadonlyMap<number, Uint8Array> = new Map(),
): Untagged {
  const rest = text.slice(2)
  const head = /^(\d+) ([A-Za-z]+)/.exec(rest)
  if (head) {
    return {
      kind: (head[2] ?? '').toUpperCase(),
      number: Number(head[1]),
      values: safely(rest.slice(head[0].length), literals, 2 + head[0].length),
      line: text,
    }
  }
  const word = /^[A-Za-z]+/.exec(rest)?.[0] ?? ''
  return {
    kind: word.toUpperCase(),
    values: safely(rest.slice(word.length), literals, 2 + word.length),
    line: text,
  }
}

function safely(text: string, literals: ReadonlyMap<number, Uint8Array>, base: number): Value[] {
  try {
    return parseValues(text, literals, base)
  } catch {
    return []
  }
}

export function itemsOf(values: readonly Value[]): Map<string, Value> {
  const items = new Map<string, Value>()
  const list = values[0]
  if (!Array.isArray(list)) return items
  for (let at = 0; at + 1 < list.length; at += 2) {
    const key = list[at]
    if (typeof key === 'string') items.set(key.toUpperCase(), list[at + 1] ?? null)
  }
  return items
}

export function quoted(text: string): string {
  return `"${text.replace(/[\\"]/g, (char) => `\\${char}`)}"`
}

class ImapError extends Error {
  constructor(
    message: string,
    readonly kind: 'NO' | 'BAD' | 'BYE' | 'closed',
  ) {
    super(message)
  }
}

interface Pending {
  tag: string
  untagged: Untagged[]
  done: (lines: Untagged[]) => void
  failed: (error: Error) => void
}

export class Imap {
  capabilities = new Set<string>()
  hear: (one: Untagged) => void = () => undefined
  ended: (reason?: string) => void = () => undefined

  private readonly reader = new Reader()
  private building = ''
  private literals = new Map<number, Uint8Array>()
  private wanting: number | null = null
  private counter = 0
  private pending: Pending | null = null
  private continued: (() => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private greeted: ((line: string) => void) | null = null
  private readonly greeting: Promise<string>
  private closed = false
  private stop: () => void = () => undefined

  private constructor(private readonly socket: Socket) {
    this.greeting = new Promise((resolve) => (this.greeted = resolve))
    const stop = socket.read(
      (bytes) => this.arrived(bytes),
      (reason) => this.end(reason),
    )
    this.stop = stop
    if (this.closed) stop()
  }

  static async open(
    open: (ask: SocketAsk) => Promise<Socket>,
    ask: SocketAsk,
    user: string,
    password: string,
  ): Promise<Imap> {
    const socket = await open(ask)
    const imap = new Imap(socket)
    try {
      const greeting = await imap.greeting
      if (/^\* BYE/i.test(greeting)) throw new ImapError(greeting, 'BYE')
      imap.readCapabilities(greeting)
      if (!imap.capabilities.size) await imap.command('CAPABILITY')
      if (ask.tls === 'starttls') {
        if (!imap.capabilities.has('STARTTLS')) {
          throw new ImapError('the server does not offer STARTTLS', 'NO')
        }
        await imap.command('STARTTLS')
        await socket.startTls()
        imap.capabilities.clear()
        await imap.command('CAPABILITY')
      }
      if (!/^\* PREAUTH/i.test(greeting)) await imap.login(user, password)
      if (!imap.capabilities.has('IMAP4REV1') || imap.capabilities.size < 2) {
        imap.capabilities.clear()
        await imap.command('CAPABILITY')
      }
      return imap
    } catch (error) {
      await imap.close()
      throw error
    }
  }

  private async login(user: string, password: string): Promise<void> {
    if (this.capabilities.has('AUTH=PLAIN') && this.capabilities.has('SASL-IR')) {
      const said = toBase64(new TextEncoder().encode(`\0${user}\0${password}`))
      await this.command(`AUTHENTICATE PLAIN ${said}`)
      return
    }
    if (this.capabilities.has('LOGINDISABLED')) {
      throw new ImapError('the server refuses a login over this connection', 'NO')
    }
    if (/^[\x20-\x7e]*$/.test(password)) {
      await this.command(`LOGIN ${quoted(user)} ${quoted(password)}`)
    } else {
      await this.command(`LOGIN ${quoted(user)}`, ascii(password))
    }
  }

  private readCapabilities(line: string): void {
    const found = /\[CAPABILITY ([^\]]*)\]/i.exec(line) ?? /^\* CAPABILITY (.*)$/i.exec(line)
    if (!found?.[1]) return
    this.capabilities = new Set(found[1].trim().toUpperCase().split(/\s+/))
  }

  command(text: string, literal?: Uint8Array): Promise<Untagged[]> {
    const run = this.queue.then(() => this.send(text, literal))
    this.queue = run.catch(() => undefined)
    return run
  }

  private send(text: string, literal?: Uint8Array): Promise<Untagged[]> {
    if (this.closed) return Promise.reject(new ImapError('the connection is closed', 'closed'))
    const tag = `A${++this.counter}`
    return new Promise<Untagged[]>((done, failed) => {
      this.pending = { tag, untagged: [], done, failed }
      if (!literal) {
        void this.socket.write(fromLatin(`${tag} ${text}\r\n`)).catch(failed)
        return
      }
      const plus = this.capabilities.has('LITERAL+')
      const head = fromLatin(`${tag} ${text} {${literal.length}${plus ? '+' : ''}}\r\n`)
      const rest = concat([literal, new Uint8Array([13, 10])])
      if (plus) {
        void this.socket.write(concat([head, rest])).catch(failed)
        return
      }
      this.continued = () => void this.socket.write(rest).catch(failed)
      void this.socket.write(head).catch(failed)
    })
  }

  async idle(): Promise<() => Promise<void>> {
    let entered: () => void = () => undefined
    const ready = new Promise<void>((resolve) => (entered = resolve))
    await this.queue
    const tag = `A${++this.counter}`
    const finished = new Promise<Untagged[]>((done, failed) => {
      this.pending = { tag, untagged: [], done, failed }
    })
    this.continued = entered
    this.queue = finished.catch(() => undefined)
    await this.socket.write(ascii(`${tag} IDLE\r\n`))
    await Promise.race([ready, finished])
    return async () => {
      if (!this.closed) await this.socket.write(ascii('DONE\r\n')).catch(() => undefined)
      await finished.catch(() => undefined)
    }
  }

  private arrived(bytes: Uint8Array): void {
    this.reader.push(bytes)
    for (;;) {
      if (this.wanting !== null) {
        const literal = this.reader.take(this.wanting)
        if (!literal) return
        this.literals.set(this.building.length, literal)
        this.wanting = null
      }
      const line = this.reader.line()
      if (line === null) return
      this.building += line
      const literal = /\{(\d+)\+?\}$/.exec(line)
      if (literal) {
        this.wanting = Number(literal[1])
        continue
      }
      const whole = this.building
      const literals = this.literals
      this.building = ''
      this.literals = new Map()
      this.response(whole, literals)
    }
  }

  private response(text: string, literals: ReadonlyMap<number, Uint8Array>): void {
    if (this.greeted) {
      const greeted = this.greeted
      this.greeted = null
      greeted(text)
      return
    }
    if (text.startsWith('+')) {
      const next = this.continued
      this.continued = null
      next?.()
      return
    }
    if (text.startsWith('* ')) {
      const one = untaggedOf(text, literals)
      if (one.kind === 'CAPABILITY' || /\[CAPABILITY /i.test(text)) this.readCapabilities(text)
      this.pending?.untagged.push(one)
      this.hear(one)
      if (one.kind === 'BYE') this.end(text)
      return
    }
    const pending = this.pending
    const tagged = /^(\S+) (OK|NO|BAD)\b ?(.*)$/i.exec(text)
    if (!pending || tagged?.[1] !== pending.tag) return
    this.pending = null
    this.continued = null
    if (/\[CAPABILITY /i.test(text)) this.readCapabilities(text)
    const status = (tagged[2] ?? '').toUpperCase()
    if (status === 'OK') pending.done(pending.untagged)
    else
      pending.failed(
        new ImapError(tagged[3]?.trim() ? tagged[3] : status, status === 'NO' ? 'NO' : 'BAD'),
      )
  }

  private end(reason?: string): void {
    if (this.closed) return
    this.closed = true
    this.stop()
    this.pending?.failed(new ImapError(reason ?? 'the connection closed', 'closed'))
    this.pending = null
    this.greeted?.(`* BYE ${reason ?? 'the connection closed'}`)
    this.ended(reason)
  }

  alive(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    if (!this.closed) {
      await Promise.race([
        this.command('LOGOUT').catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ])
    }
    this.end()
    await this.socket.close().catch(() => undefined)
  }
}

export function bytesOf(value: Value | undefined): Uint8Array {
  if (value instanceof Uint8Array) return value
  return typeof value === 'string' ? fromLatin(value) : new Uint8Array(0)
}

export function textOf(value: Value | undefined): string {
  if (value instanceof Uint8Array) return latin(value)
  return typeof value === 'string' ? value : ''
}
