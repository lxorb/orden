import type { Socket, SocketAsk } from '../provider'
import { ascii, concat, fromLatin, latin, Reader, toBase64 } from './bytes'

class SmtpError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
  }
}

interface Reply {
  code: number
  lines: string[]
}

class Talk {
  private readonly reader = new Reader()
  private lines: string[] = []
  private waiting: ((reply: Reply) => void) | null = null
  private failing: ((error: Error) => void) | null = null
  private readonly replies: Reply[] = []
  private ended: string | null = null
  private readonly stop: () => void

  constructor(readonly socket: Socket) {
    this.stop = socket.read(
      (bytes) => {
        this.reader.push(bytes)
        for (let line = this.reader.line(); line !== null; line = this.reader.line()) {
          this.lines.push(line)
          if (/^\d{3}-/.test(line)) continue
          const reply = { code: Number(line.slice(0, 3)) || 0, lines: this.lines }
          this.lines = []
          const waiting = this.waiting
          this.waiting = null
          if (waiting) waiting(reply)
          else this.replies.push(reply)
        }
      },
      (reason) => {
        this.ended = reason ?? 'the connection closed'
        this.failing?.(new SmtpError(this.ended, 0))
      },
    )
  }

  reply(): Promise<Reply> {
    const held = this.replies.shift()
    if (held) return Promise.resolve(held)
    if (this.ended) return Promise.reject(new SmtpError(this.ended, 0))
    return new Promise((resolve, reject) => {
      this.waiting = resolve
      this.failing = reject
    })
  }

  async say(line: string | Uint8Array, expect: readonly number[]): Promise<Reply> {
    await this.socket.write(typeof line === 'string' ? ascii(`${line}\r\n`) : line)
    return this.expect(expect)
  }

  async expect(codes: readonly number[]): Promise<Reply> {
    const reply = await this.reply()
    if (!codes.includes(reply.code)) {
      throw new SmtpError(reply.lines.map((one) => one.slice(4)).join(' ') || 'refused', reply.code)
    }
    return reply
  }

  close(): void {
    this.stop()
  }
}

export function dotStuffed(message: Uint8Array): Uint8Array {
  const text = latin(message).replace(/\r?\n/g, '\r\n')
  const body = text.replace(/^\./gm, '..')
  return concat([fromLatin(body.endsWith('\r\n') ? body : `${body}\r\n`), ascii('.\r\n')])
}

export interface Envelope {
  from: string
  to: readonly string[]
}

export async function sendMail(
  open: (ask: SocketAsk) => Promise<Socket>,
  ask: SocketAsk,
  login: { user: string; password: string },
  envelope: Envelope,
  message: Uint8Array,
): Promise<void> {
  const talk = new Talk(await open(ask))
  try {
    await talk.expect([220])
    const name = 'orden.local'
    let hello = await talk.say(`EHLO ${name}`, [250])
    if (ask.tls === 'starttls') {
      await talk.say('STARTTLS', [220])
      await talk.socket.startTls()
      hello = await talk.say(`EHLO ${name}`, [250])
    }
    const offered = hello.lines.map((one) => one.slice(4).toUpperCase())
    const auth = offered.find((one) => one.startsWith('AUTH')) ?? ''
    const plain = toBase64(new TextEncoder().encode(`\0${login.user}\0${login.password}`))
    if (/\bPLAIN\b/.test(auth) || !/\bLOGIN\b/.test(auth)) {
      await talk.say(`AUTH PLAIN ${plain}`, [235])
    } else {
      await talk.say('AUTH LOGIN', [334])
      await talk.say(toBase64(new TextEncoder().encode(login.user)), [334])
      await talk.say(toBase64(new TextEncoder().encode(login.password)), [235])
    }
    const utf8 = offered.some((one) => one === 'SMTPUTF8')
    await talk.say(`MAIL FROM:<${envelope.from}>${utf8 ? ' SMTPUTF8' : ''}`, [250])
    for (const to of envelope.to) await talk.say(`RCPT TO:<${to}>`, [250, 251])
    await talk.say('DATA', [354])
    await talk.say(dotStuffed(message), [250])
    await talk.say('QUIT', [221]).catch(() => undefined)
  } finally {
    talk.close()
    await talk.socket.close().catch(() => undefined)
  }
}
