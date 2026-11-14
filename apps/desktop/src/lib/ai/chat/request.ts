import {
  chatgptPlan,
  readKey,
  headersFor,
  type Provider,
  reachable,
  troubleIn,
  usable,
  sseJson,
} from '../../ai-providers/src/api'

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

async function headers(
  provider: Provider,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  if (!usable({ ...provider, model: provider.model || '-' })) {
    throw new Error('That provider is not set up yet.')
  }
  const apiKey = await keyFor(provider)
  if (!reachable(provider, !!apiKey)) throw new Error('That provider is not set up yet.')
  return { ...headersFor(provider, apiKey), ...extra }
}

export async function request(
  provider: Provider,
  url: string,
  init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
  signal?: AbortSignal,
): Promise<Response> {
  const sent = await headers(provider, init.headers)
  const response = await fetch(url, {
    method: init.method ?? 'POST',
    headers: sent,
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(signal ? { signal } : {}),
  }).catch((error: unknown) => {
    if (wasStopped(error)) throw error
    throw new Error(`Could not reach ${url}`)
  })
  if (!response.ok) throw await refusalOf(response, provider)
  return response
}

async function refusalOf(response: Response, provider: Provider): Promise<Refused> {
  const text = await response.text().catch(() => '')
  return refusalIn(sseJson(text), response.status, provider)
}

export async function refusalIn(
  body: unknown,
  status: number,
  provider: Provider,
): Promise<Refused> {
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
  const error =
    typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
  if (typeof error !== 'object' || error === null) return { param: '', code: '' }
  const { param, code, type } = error as { param?: unknown; code?: unknown; type?: unknown }
  return {
    param: typeof param === 'string' ? param : '',
    code: typeof code === 'string' ? code : typeof type === 'string' ? type : '',
  }
}
