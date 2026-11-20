import {
  chatgptPlan,
  readKey,
  headersFor,
  type Provider,
  reachable,
  troubleIn,
  usable,
  sseJson,
} from '../../../ai-providers/src/api'

export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly param: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'Refused'
  }
}
export function wasStopped(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
async function keyFor(provider: Provider): Promise<string> {
  if (provider.kind !== 'chatgpt') return await readKey(provider)
  const { planToken } = await chatgptPlan()
  return await planToken()
}
async function headers(provider: Provider, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  if (!usable({ ...provider, model: provider.model || '-' })) {
    throw new Error('That provider is not set up yet.')
  }
  const apiKey = await keyFor(provider)
  if (!reachable(provider, !!apiKey)) throw new Error('That provider is not set up yet.')
  return { ...headersFor(provider, apiKey), ...extra }
}
const AGAIN = new Set([408, 409, 429])
export const TRIES = 4
const FIRST_WAIT = 500
const LONGEST_STEP = 8_000
const LONGEST_WAIT = 60_000
function stopped(): DOMException {
  return new DOMException('stopped', 'AbortError')
}
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done, failed) => {
    if (signal?.aborted) {
      failed(stopped())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', gone)
      done()
    }, ms)
    const gone = () => {
      clearTimeout(timer)
      failed(stopped())
    }
    signal?.addEventListener('abort', gone, { once: true })
  })
}
export const pacing = { sleep, random: Math.random }
function waitOf(response: Response | null, tries: number, now = Date.now()): number {
  const ms = Number(response?.headers.get('retry-after-ms') ?? NaN)
  if (Number.isFinite(ms) && ms >= 0) return ms
  const said = response?.headers.get('retry-after')?.trim() ?? ''
  if (/^\d+(?:\.\d+)?$/.test(said)) return Number(said) * 1000
  const at = said ? Date.parse(said) : NaN
  if (Number.isFinite(at)) return Math.max(0, at - now)
  const step = Math.min(LONGEST_STEP, FIRST_WAIT * 2 ** tries)
  return Math.round(step * (0.5 + pacing.random() / 2))
}
function goesAgain(status: number): boolean {
  return AGAIN.has(status) || status >= 500
}
export async function request(
  provider: Provider,
  url: string,
  init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
  signal?: AbortSignal,
): Promise<Response> {
  const sent = await headers(provider, init.headers)
  for (let tries = 0; ; tries++) {
    if (signal?.aborted) throw stopped()
    const answered = await fetch(url, {
      method: init.method ?? 'POST',
      headers: sent,
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(signal ? { signal } : {}),
    }).catch((error: unknown) => {
      if (wasStopped(error)) throw error
      return new Error(`Could not reach ${url}`)
    })
    const response = answered instanceof Error ? null : answered
    if (response?.ok) return response
    const last = tries + 1 >= TRIES
    if (response && (last || !goesAgain(response.status))) throw await refusalOf(response, provider)
    const wait = waitOf(response, tries)
    if (last || wait > LONGEST_WAIT) throw answered instanceof Error ? answered : await refusalOf(answered, provider)
    await response?.body?.cancel().catch(() => undefined)
    await pacing.sleep(wait, signal)
  }
}
async function refusalOf(response: Response, provider: Provider): Promise<Refused> {
  const text = await response.text().catch(() => '')
  return refusalIn(sseJson(text), response.status, provider)
}
export async function refusalIn(body: unknown, status: number, provider: Provider): Promise<Refused> {
  const { param, code } = detailsIn(body)
  if (provider.kind === 'chatgpt') {
    const { planRefusal } = await chatgptPlan()
    const plan = planRefusal(status, body)
    if (plan) return new Refused(plan, status, param, code)
  }
  const said = troubleIn(body)
  if (said) return new Refused(said, status, param, code)
  if (status === 401 || status === 403) {
    return new Refused('That key was refused.', status, param, code)
  }
  return new Refused(`The provider answered ${status}.`, status, param, code)
}
function detailsIn(body: unknown): { param: string; code: string } {
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
  if (typeof error !== 'object' || error === null) return { param: '', code: '' }
  const { param, code, type } = error as { param?: unknown; code?: unknown; type?: unknown }
  return {
    param: typeof param === 'string' ? param : '',
    code: typeof code === 'string' ? code : typeof type === 'string' ? type : '',
  }
}
