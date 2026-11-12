import type { Env } from '../../../sync-server/src/api'
import { OPENAI } from './models'

const TRANSCRIBERS = ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'] as const

const WHISPERS = ['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper'] as const

const LONGEST_SECONDS = 12

export const PIECE_SECONDS = 120

const BYTES_A_SECOND = 32_000

function secondsIn(audio: ArrayBuffer): number {
  const bytes = new Uint8Array(audio)
  if (bytes.length < 44) return bytes.length / BYTES_A_SECOND

  const view = new DataView(audio)
  const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
  const wave = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0)
  if (riff !== 'RIFF' || wave !== 'WAVE') return bytes.length / BYTES_A_SECOND

  const rate = view.getUint32(28, true)
  if (!rate) return bytes.length / BYTES_A_SECOND

  return (bytes.length - 44) / rate
}

export function shortEnough(audio: ArrayBuffer, longest = LONGEST_SECONDS): boolean {
  return secondsIn(audio) <= longest
}

function base64(audio: ArrayBuffer): string {
  const bytes = new Uint8Array(audio)
  let out = ''
  for (let at = 0; at < bytes.length; at += 8192) {
    out += String.fromCharCode(...bytes.subarray(at, at + 8192))
  }

  return btoa(out)
}

function textIn(answer: unknown): string {
  if (typeof answer !== 'object' || answer === null) return ''

  const said = (answer as { text?: unknown }).text
  return typeof said === 'string' ? said.trim() : ''
}

function languageIn(answer: unknown): string {
  if (typeof answer !== 'object' || answer === null) return ''

  const info = (answer as { transcription_info?: unknown }).transcription_info
  if (typeof info !== 'object' || info === null) return ''

  const said = (info as { language?: unknown }).language
  return typeof said === 'string' ? said.trim().slice(0, 20) : ''
}

export async function heard(
  env: Env,
  audio: ArrayBuffer,
  key: string | null,
  like = '',
): Promise<Heard> {
  const said = await whisperHeard(env, audio, like)
  if (said.said) return said

  const otherwise = key ? await openAiHeard(audio, key, like) : null
  return { said: otherwise, language: '' }
}

export interface Heard {
  said: string | null
  language: string
}

async function openAiHeard(audio: ArrayBuffer, key: string, like = ''): Promise<string | null> {
  for (const model of TRANSCRIBERS) {
    const form = new FormData()
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'said.wav')
    form.append('model', model)
    form.append('response_format', 'text')
    if (like) form.append('prompt', like)

    const answered = await fetch(`${OPENAI}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    }).catch(() => null)
    if (!answered?.ok) continue

    const said = (await answered.text()).trim()
    if (said) return said
  }

  return null
}

async function whisperHeard(env: Env, audio: ArrayBuffer, like = ''): Promise<Heard> {
  const ai = env.AI
  const nothing: Heard = { said: null, language: '' }
  if (!ai) return nothing

  for (const model of WHISPERS) {
    const input =
      model === '@cf/openai/whisper-large-v3-turbo'
        ? { audio: base64(audio), ...(like ? { initial_prompt: like } : {}) }
        : { audio: [...new Uint8Array(audio)] }

    try {
      const answer = await ai.run(model, input)
      const said = textIn(answer)
      if (said) return { said, language: languageIn(answer) }
    } catch {
      continue
    }
  }

  return nothing
}
