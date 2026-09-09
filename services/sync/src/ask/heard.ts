/** One utterance, as words, with or without an account's own OpenAI key.
 *
 *  Two transcribers, and which one listens is decided by whether the account has a
 *  key rather than by anything the reader has to choose:
 *
 *  1. **OpenAI**, with the account's own key, where there is one. It is the better
 *    of the two at a phrase said into a pair of glasses on a street, and the reader
 *    is spending their own credit on it.
 *  2. **Workers AI's Whisper**, where there is not. Emil has no OpenAI account at
 *     all, and a plugin that answers "no way to listen" to somebody wearing a pair of
 *     glasses with a working microphone is the wrong answer to the wrong question:
 *     the microphone is there, and so is a model, on the same Worker that is already
 *     answering the request.
 *
 *  Nothing on the glasses does this. The SDK hands a plugin raw PCM frames -
 *  `AudioEvent` carries `audioPcm`, a source, a direction and a speaker role, and
 *  that is the whole of it - and there is no speech to text anywhere in
 *  `@evenrealities/even_hub_sdk` 0.0.15. So it is ours to do or it does not happen.
 *
 *  What arrives is a RIFF WAVE of sixteen bit little endian PCM at 16 kHz, built out
 *  of the frames the glasses sent; see the plugin's voice.ts. Both models take a
 *  file, so nothing is re-encoded on the way. */

import type { Env } from '../types'
import { OPENAI } from './models'

/** The models that turn sound into words with the account's own key, in the order
 *  they are tried.
 *
 *  Verified against `GET /v1/models` on 2026-09-09. The first that the account
 *  actually has is used; `whisper-1` has been there for years and is the floor. */
const TRANSCRIBERS = ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'] as const

/** Whisper on Workers AI, in the order they are tried.
 *
 *  The turbo model takes the file as base64 and is the faster of the two; the older
 *  one takes it as an array of bytes. Both are asked for the same thing, so a
 *  release that changes one of them out from under us falls to the other rather than
 *  to silence.
 *
 *  Workers AI has a free daily allowance and is billed per neuron past it; a command
 *  said into a pair of glasses is a second or two of audio. */
const WHISPERS = ['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper'] as const

/** How long an utterance may be.
 *
 *  Twelve seconds. A spoken command is one or two, a dictated question is five, and
 *  anything past this arrived from something other than somebody talking to their
 *  glasses - a pocket, a room, a bug. Measured from the file's own header where it
 *  has one, because the point is the seconds rather than the bytes. */
const LONGEST_SECONDS = 12

/** What a second of the glasses' own audio comes to: 16 kHz, sixteen bits, one
 *  channel. Used only where a file arrived without a header to say otherwise. */
const BYTES_A_SECOND = 32_000

/** How long a WAV is, in seconds, read off its own header.
 *
 *  Read field by field like anything else crossing a boundary: what arrives is bytes
 *  somebody sent, and a header that says a byte rate of zero would otherwise be a
 *  division. Falls back to the rate the glasses send at, which is what the plugin
 *  builds these out of. */
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

/** Whether an utterance is short enough to be somebody talking to their glasses. */
export function shortEnough(audio: ArrayBuffer): boolean {
  return secondsIn(audio) <= LONGEST_SECONDS
}

function base64(audio: ArrayBuffer): string {
  const bytes = new Uint8Array(audio)
  let out = ''
  // In pieces, because a spread of a hundred thousand arguments is a stack overflow
  // rather than a string.
  for (let at = 0; at < bytes.length; at += 8192) {
    out += String.fromCharCode(...bytes.subarray(at, at + 8192))
  }

  return btoa(out)
}

/** The words in an answer from Workers AI, read field by field. */
function textIn(answer: unknown): string {
  if (typeof answer !== 'object' || answer === null) return ''

  const said = (answer as { text?: unknown }).text
  return typeof said === 'string' ? said.trim() : ''
}

/** One utterance, as words, or null when nothing was heard.
 *
 *  Null rather than an error: an utterance nothing could make anything of is the
 *  ordinary case of a door closing, and the plugin's own answer to it is to say
 *  nothing. Which model listened is not the caller's business. */
export async function heard(
  env: Env,
  audio: ArrayBuffer,
  key: string | null,
): Promise<string | null> {
  if (key) {
    const said = await openAiHeard(audio, key)
    if (said) return said
  }

  return whisperHeard(env, audio)
}

async function openAiHeard(audio: ArrayBuffer, key: string): Promise<string | null> {
  for (const model of TRANSCRIBERS) {
    const form = new FormData()
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'said.wav')
    form.append('model', model)
    // A command is English or the reader's own language; left to the model, which
    // does better at guessing than a setting nobody will find.
    form.append('response_format', 'text')

    const answered = await fetch(`${OPENAI}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    })
    if (!answered.ok) continue

    const said = (await answered.text()).trim()
    if (said) return said
  }

  return null
}

async function whisperHeard(env: Env, audio: ArrayBuffer): Promise<string | null> {
  const ai = env.AI
  if (!ai) return null

  for (const model of WHISPERS) {
    // The turbo model takes the file as base64; the older one takes its bytes.
    const input =
      model === '@cf/openai/whisper-large-v3-turbo'
        ? { audio: base64(audio) }
        : { audio: [...new Uint8Array(audio)] }

    try {
      const said = textIn(await ai.run(model, input))
      if (said) return said
    } catch {
      // A model that is not there any more, or a shape it stopped taking: the next
      // one is asked, and silence is the answer if neither will.
      continue
    }
  }

  return null
}
