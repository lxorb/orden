import { api, account } from '../accounts/src/api'
import { roomDelay, waited } from '../platform/src/api'
import { transcriberNow } from '../ai/hears'
import type { Provider } from '../ai/providers'
import { message } from '../message'
import { mono, pieces, RATE, resampled, wavOf } from './wav'

const FILE_SECONDS = 60

const MOST_DECODED = 12 * 1024 * 1024

const TRIES = 3

const HEARD_WITHIN = 120_000

export interface Words {
  text: string
  language: string
}

export const WHISPER = 'whisper'

const MODELS: Record<'openai' | 'compatible', readonly string[]> = {
  openai: ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
  compatible: ['whisper-1'],
}

const answering = new Map<string, string>()

function modelsFor(provider: Provider): string[] {
  const listed = provider.kind === 'openai' ? MODELS.openai : MODELS.compatible
  const own = provider.model && !listed.includes(provider.model) ? [provider.model] : []
  const every = [...listed, ...own]

  const remembered = answering.get(provider.id)
  return remembered ? [remembered, ...every.filter((one) => one !== remembered)] : every
}

export function transcribedBy(): string {
  const provider = transcriberNow()
  if (!provider) return WHISPER

  return modelsFor(provider)[0] ?? WHISPER
}

async function heardByProvider(
  provider: Provider,
  wav: Uint8Array<ArrayBuffer>,
  prompt: string,
): Promise<Words> {
  const { readKey } = await import('../ai/keys')
  const { headersWithoutType, heardUrl, reachable, troubleIn } = await import('../ai/providers')

  const apiKey = await readKey(provider)
  if (!reachable(provider, !!apiKey)) throw new Error('That provider is not set up yet.')

  let refused: Error | null = null

  for (const model of modelsFor(provider)) {
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'said.wav')
    form.append('model', model)
    form.append('response_format', model === 'whisper-1' ? 'verbose_json' : 'json')
    if (prompt) form.append('prompt', prompt)

    const response = await fetch(heardUrl(provider), {
      method: 'POST',
      headers: headersWithoutType(provider, apiKey),
      body: form,
      signal: AbortSignal.timeout(HEARD_WITHIN),
    }).catch(() => null)

    if (!response) throw new Error(`Could not reach ${heardUrl(provider)}`)

    const said = await response.text().catch(() => '')

    if (!response.ok) {
      refused = new Error(refusal(response.status, said, troubleIn))
      if (!aboutTheModel(said)) throw refused

      if (answering.get(provider.id) === model) answering.delete(provider.id)
      continue
    }

    answering.set(provider.id, model)
    return wordsIn(said)
  }

  throw refused ?? new Error('The provider answered 0.')
}

function wordsIn(body: string): Words {
  try {
    const held: unknown = JSON.parse(body)
    if (typeof held === 'object' && held !== null) {
      const said = held as { text?: unknown; language?: unknown }
      return {
        text: typeof said.text === 'string' ? said.text : '',
        language: typeof said.language === 'string' ? said.language : '',
      }
    }
  } catch {
    // Not JSON, so it is the words.
  }

  return { text: body.trim(), language: '' }
}

function aboutTheModel(body: string): boolean {
  return /model/i.test(body)
}

function refusal(
  status: number,
  body: string,
  troubleIn: (body: unknown) => string | null,
): string {
  const said = troubleIn(parsed(body))
  if (said) return said

  if (status === 401 || status === 403) return 'That key was refused.'
  return `The provider answered ${status}.`
}

function parsed(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

export interface Hearing {
  prompt?: string
  road?: 'provider' | 'account'
  tries?: number
}

export async function heardPiece(
  wav: Uint8Array<ArrayBuffer>,
  hearing: Hearing = {},
): Promise<Words> {
  const provider = hearing.road === 'account' ? null : transcriberNow()
  const token = account.accountToken
  if (!provider && (!token || hearing.road === 'provider')) {
    throw new Error('Add an AI provider or sign in to turn speech into words.')
  }

  const prompt = hearing.prompt ?? ''
  const tries = hearing.tries ?? TRIES
  let trouble: unknown = null

  for (let round = 1; round <= tries; round++) {
    try {
      if (provider) return await heardByProvider(provider, wav, prompt)

      const said = await api.askPiece(token ?? '', wav, prompt)
      return { text: said.said ?? '', language: said.language }
    } catch (error) {
      trouble = error
      if (round < tries) await waited(roomDelay(round))
    }
  }

  throw new Error(message(trouble, 'That recording could not be turned into words.'))
}

export async function wordsInFile(bytes: ArrayBuffer): Promise<Words> {
  if (bytes.byteLength > MOST_DECODED) {
    throw new Error('That recording is too long to turn into words in one go.')
  }

  const samples = await decoded(bytes)
  const parts = pieces(samples, RATE, FILE_SECONDS)

  const said: string[] = []
  let language = ''

  for (const part of parts) {
    const heard = await heardPiece(wavOf(part, RATE))
    if (heard.text) said.push(heard.text)
    if (!language) language = heard.language
  }

  return { text: said.join('\n\n'), language }
}

async function decoded(bytes: ArrayBuffer): Promise<Float32Array> {
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: RATE })

  const buffer = await context.decodeAudioData(bytes.slice(0))
  const channels: Float32Array[] = []
  for (let one = 0; one < buffer.numberOfChannels; one++) channels.push(buffer.getChannelData(one))

  return resampled(mono(channels), buffer.sampleRate, RATE)
}
