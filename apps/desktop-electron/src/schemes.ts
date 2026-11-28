import { protocol, session } from 'electron'
import type { CustomScheme } from 'electron'
import { SCHEMES } from './wire'
import type { Pair, ToShell } from './wire'
import type { Send } from './windows'

const MARK = 'x-orden-webview'
const FROM = 'x-orden-origin'
const BODILESS = new Set([204, 205, 304])
interface Asked {
  answer: (response: Response) => void
  head: boolean
}
export const PRIVILEGED: CustomScheme[] = SCHEMES.map((scheme) => ({
  scheme,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    codeCache: scheme === 'tauri',
  },
}))
export class Requests {
  readonly #asked = new Map<number, Asked>()
  readonly #send: Send
  readonly #pageOf: (contents: number) => number | undefined
  #last = 0
  constructor(send: Send, pageOf: (contents: number) => number | undefined) {
    this.#send = send
    this.#pageOf = pageOf
  }
  serve(): void {
    for (const scheme of SCHEMES) protocol.handle(scheme, (request) => this.#ask(request))
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: SCHEMES.map((scheme) => `${scheme}://*/*`) },
      (details, done) => {
        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(details.requestHeaders))
          if (name.toLowerCase() !== MARK && name.toLowerCase() !== FROM) headers[name] = value
        const page = details.webContentsId === undefined ? undefined : this.#pageOf(details.webContentsId)
        if (page !== undefined) headers[MARK] = String(page)
        const origin = details.frame?.origin
        if (origin && origin !== 'null') headers[FROM] = origin
        done({ requestHeaders: headers })
      },
    )
  }
  respond(said: Extract<ToShell, { op: 'respond' }>, body: Buffer): void {
    const asked = this.#asked.get(said.request)
    if (!asked) return
    this.#asked.delete(said.request)
    try {
      const empty = asked.head || BODILESS.has(said.status)
      asked.answer(
        new Response(empty ? null : (body as Uint8Array<ArrayBuffer>), { status: said.status, headers: said.headers }),
      )
    } catch {
      asked.answer(Response.error())
    }
  }
  refuse(request: number): void {
    this.#asked.get(request)?.answer(Response.error())
    this.#asked.delete(request)
  }
  drop(): void {
    for (const asked of this.#asked.values()) asked.answer(Response.error())
    this.#asked.clear()
  }
  #ask(request: Request): Promise<Response> {
    const id = ++this.#last
    const headers: Pair[] = []
    let webview: number | null = null
    let from: string | null = null
    let origin = false
    for (const [name, value] of request.headers) {
      const lower = name.toLowerCase()
      if (lower === MARK) webview = Number(value)
      else if (lower === FROM) from = value
      else {
        origin ||= lower === 'origin'
        headers.push([name, value])
      }
    }
    if (!origin && from !== null) headers.push(['origin', from])
    return new Promise((answer) => {
      this.#asked.set(id, { answer, head: request.method === 'HEAD' })
      const pass = (body?: Uint8Array): void => {
        this.#send({ op: 'request', request: id, webview, url: request.url, method: request.method, headers }, body)
      }
      if (request.body)
        request.arrayBuffer().then(
          (body) => {
            pass(new Uint8Array(body))
          },
          () => {
            pass()
          },
        )
      else pass()
    })
  }
}
