import { readKey } from './keys'
import {
  askUrl,
  bodyFor,
  deltaIn,
  headersFor,
  isLocal,
  type Message,
  modelsIn,
  modelsUrl,
  type Provider,
  reachable,
  talkable,
  troubleIn,
  usable,
} from './providers'
import { sseJson, sseLines } from './stream'

export interface Ask {
  provider: Provider
  model: string
  messages: readonly Message[]
  stream?: (text: string) => void
  named?: (model: string) => void
  signal?: AbortSignal
}

export async function complete(ask: Ask): Promise<string> {
  if (!__EVEN_PLUGIN__ && isLocal(ask.provider.kind)) {
    const { askLocal } = await import('./local/ask')
    return await askLocal({ ...ask, provider: { ...ask.provider, kind: ask.provider.kind } })
  }

  const provider: Provider = { ...ask.provider, model: ask.model }
  if (!usable(provider)) throw new Error('That provider is not set up yet.')

  const apiKey = await keyFor(provider)
  if (!reachable(provider, !!apiKey)) throw new Error('That provider is not set up yet.')

  const streaming = !!ask.stream || provider.kind === 'chatgpt' || provider.kind === 'gemini'

  const response = await fetch(askUrl(provider), {
    method: 'POST',
    headers: headersFor(provider, apiKey),
    body: bodyFor(provider, ask.messages, streaming),
    ...(ask.signal ? { signal: ask.signal } : {}),
  }).catch((error: unknown) => {
    if (wasStopped(error)) throw error
    throw new Error(`Could not reach ${askUrl(provider)}`)
  })

  if (!response.ok) throw new Error(await refusal(response, provider))
  ask.named?.(provider.model)
  if (!streaming || !response.body) return whole(await response.text(), provider)

  return await streamed(response.body, provider, ask.stream)
}

async function keyFor(provider: Provider): Promise<string> {
  if (__EVEN_PLUGIN__ || provider.kind !== 'chatgpt') return await readKey(provider)
  const { planToken } = await import('./chatgpt')
  return await planToken()
}

export function wasStopped(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function refusal(response: Response, provider: Provider): Promise<string> {
  const text = await response.text().catch(() => '')
  const body = sseJson(text)
  const plan = await planSaid(provider, response.status, body)
  if (plan) return plan

  const said = troubleIn(body)
  if (said) return said

  if (response.status === 401 || response.status === 403) return 'That key was refused.'
  return `The provider answered ${response.status}.`
}

async function planSaid(provider: Provider, status: number, body: unknown): Promise<string | null> {
  if (__EVEN_PLUGIN__ || provider.kind !== 'chatgpt') return null
  const { planRefusal } = await import('./chatgpt')
  return planRefusal(status, body)
}

function whole(text: string, provider: Provider): string {
  const body = sseJson(text)
  const said = troubleIn(body)
  if (said) throw new Error(said)

  if (typeof body !== 'object' || body === null) return ''

  if (provider.kind === 'anthropic') {
    const content = (body as { content?: unknown }).content
    if (!Array.isArray(content)) return ''
    return content
      .map((one) =>
        typeof one === 'object' &&
        one !== null &&
        typeof (one as { text?: unknown }).text === 'string'
          ? (one as { text: string }).text
          : '',
      )
      .join('')
  }

  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
  return typeof message === 'string' ? message : ''
}

async function streamed(
  body: ReadableStream<Uint8Array>,
  provider: Provider,
  wrote: ((text: string) => void) | undefined,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let held = ''
  let answer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      const { payloads, rest } = sseLines(held, decoder.decode(value, { stream: true }))
      held = rest

      for (const payload of payloads) {
        const event = sseJson(payload)
        const said = troubleIn(event)
        if (said) {
          const failed = (event as { response?: unknown } | null)?.response ?? event
          throw new Error((await planSaid(provider, 0, failed)) ?? said)
        }

        const piece = deltaIn(provider.kind, event)
        if (!piece) continue
        answer += piece
        wrote?.(piece)
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }

  return answer
}

export async function listModels(provider: Provider, signal?: AbortSignal): Promise<string[]> {
  const apiKey = await keyFor(provider)
  if (!reachable(provider, !!apiKey)) throw new Error('That provider is not set up yet.')

  const response = await fetch(modelsUrl(provider), {
    headers: headersFor(provider, apiKey),
    ...(signal ? { signal } : {}),
  }).catch((error: unknown) => {
    if (wasStopped(error)) throw error
    throw new Error(`Could not reach ${modelsUrl(provider)}`)
  })

  if (!response.ok) throw new Error(await refusal(response, provider))
  return talkable(provider.kind, modelsIn(sseJson(await response.text())))
}
