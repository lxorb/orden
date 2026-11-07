import type { Host } from '../provider'

const API = 'https://slack.com/api/'

const SIGNED_OUT = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'org_login_required',
  'ekm_access_denied',
])

const MOST_TRIES = 4
const LONGEST_WAIT = 120_000

export type Said = Record<string, unknown>

export type Params = Readonly<Record<string, string | number | boolean | undefined>>

export class SlackError extends Error {
  constructor(
    readonly code: string,
    readonly needed?: string,
  ) {
    super(needed ? `Slack: ${code} (${needed})` : `Slack: ${code}`)
  }

  get signedOut(): boolean {
    return SIGNED_OUT.has(this.code)
  }
}

export const isRecord = (value: unknown): value is Said =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export const list = (value: unknown): Said[] => (Array.isArray(value) ? value.filter(isRecord) : [])

export const record = (value: unknown): Said => (isRecord(value) ? value : {})

export type Sleep = (ms: number) => Promise<void>

export const sleep: Sleep = (ms) => new Promise((done) => setTimeout(done, ms))

export class Api {
  private readonly held = new Map<string, number>()
  onSignedOut: (() => void) | null = null

  constructor(
    private readonly host: Host,
    private readonly token: string,
    private readonly wait: Sleep = sleep,
  ) {}

  async call(method: string, params: Params = {}): Promise<Said> {
    for (let tries = 1; ; tries++) {
      const until = this.held.get(method) ?? 0
      const now = this.host.now()
      if (until > now) await this.wait(until - now)
      const body = new URLSearchParams({ token: this.token })
      for (const [key, value] of Object.entries(params))
        if (value !== undefined) body.set(key, String(value))
      let answer: Response
      try {
        answer = await this.host.fetch(API + method, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
      } catch (error) {
        if (tries >= MOST_TRIES) throw new Error('Slack could not be reached', { cause: error })
        await this.wait(1000 * tries)
        continue
      }
      const said: unknown = await answer.json().catch(() => null)
      const shaped = record(said)
      const limited = answer.status === 429 || shaped.error === 'ratelimited'
      if (limited) {
        const seconds = Number(answer.headers.get('retry-after') ?? '')
        const pause = Math.min(
          LONGEST_WAIT,
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30_000 * tries,
        )
        this.held.set(method, this.host.now() + pause)
        if (tries >= MOST_TRIES) throw new SlackError('ratelimited')
        continue
      }
      if (answer.status >= 500 && tries < MOST_TRIES) {
        await this.wait(1000 * tries)
        continue
      }
      if (shaped.ok === true) return shaped
      const error = new SlackError(
        text(shaped.error) || `HTTP ${answer.status}`,
        text(shaped.needed) || undefined,
      )
      if (error.signedOut) this.onSignedOut?.()
      throw error
    }
  }

  async pages(method: string, params: Params, key: string, most = 50): Promise<Said[]> {
    return list(await this.items(method, params, key, most))
  }

  async ids(method: string, params: Params, key: string, most = 50): Promise<string[]> {
    return (await this.items(method, params, key, most)).filter(
      (one): one is string => typeof one === 'string',
    )
  }

  private async items(method: string, params: Params, key: string, most: number) {
    const all: unknown[] = []
    let cursor = ''
    for (let page = 0; page < most; page++) {
      const said = await this.call(method, { ...params, ...(cursor ? { cursor } : {}) })
      const found = said[key]
      if (Array.isArray(found)) all.push(...(found as unknown[]))
      cursor = text(record(said.response_metadata).next_cursor)
      if (!cursor) break
    }
    return all
  }
}
