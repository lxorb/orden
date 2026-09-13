/** Sound, as words, through the one path that already turns sound into words.
 *
 *  `POST /v1/ask/heard` - the route the glasses' voice commands go through, Whisper
 *  on Workers AI first and the account's own OpenAI key as the fallback. Nothing new
 *  was built to transcribe a recording: it is the same question about a different
 *  length of sound, and one path means one place where the models, the ceilings and
 *  the account's allowance are decided. See services/sync/src/ask/heard.ts.
 *
 *  Two callers. A meeting hands over a piece every twenty seconds while somebody is
 *  still talking; a Transcribe row hands over a whole file that may be half an hour
 *  long. Both end up sending the same thing - a WAV of 16 kHz mono, in pieces small
 *  enough for one request - and both come back with words and the language the model
 *  heard them in.
 *
 *  **Pieces go one at a time.** Twenty of them at once would be twenty requests
 *  against an hourly allowance the glasses share, from a phone that may be on a
 *  train, and the answers are wanted in order anyway. A failed piece is tried again
 *  on the same curve a room rejoins on, and a piece that will not go after that is
 *  said out loud rather than quietly dropped: the pill shows it, and the transcript
 *  says where the gap is. */

import { api } from '../api'
import { account } from '../account.svelte'
import { roomDelay } from '../backoff'
import { key, message } from '../i18n.svelte'
import { waited } from '../timing'
import { mono, pieces, RATE, resampled, wavOf } from './wav'

/** How long a piece of a live transcript is.
 *
 *  Twenty seconds. It is the delay between somebody speaking and their words being in
 *  the note, so shorter would be better - but every piece is a request, a model run
 *  and a sentence cut in half at each end, and under about fifteen seconds the cuts
 *  start landing inside sentences often enough to read badly. Twenty is three requests
 *  a minute, which an hour-long meeting spends 180 of an allowance of 600 on. */
export const LIVE_SECONDS = 20

/** And how long a piece of a file is.
 *
 *  Sixty seconds, which is nearly two megabytes of WAV and comfortably inside the
 *  route's four. Nobody is watching the words arrive one piece at a time here, so the
 *  pieces are as long as they may be: a ten-minute recording is ten requests rather
 *  than thirty. */
const FILE_SECONDS = 60

/** How much of a file will be decoded in one go.
 *
 *  Twelve megabytes, which is something like twenty-five minutes of Opus. Decoding is
 *  the memory ceiling rather than the request: a file becomes samples before it
 *  becomes pieces, and half an hour of them is a hundred megabytes even at the low
 *  rate this decodes to. A meeting longer than that is transcribed as it goes and
 *  never reaches this at all; a file longer than that is told so plainly. */
const MOST_DECODED = 12 * 1024 * 1024

/** How many times a piece is tried. Three: a phone changing cell loses one request,
 *  not three. */
const TRIES = 3

/** What came back: the words, and the language tag the model settled on. */
export interface Words {
  text: string
  /** Empty where the model did not say, which is most models. */
  language: string
}

/** Whether there is an account to ask. Transcribing needs one; recording does not.
 *  Asked before a row is offered rather than after it is pressed. */
export function canTranscribe(): boolean {
  return !!account.accountToken
}

/** One piece, as words, tried again where the network was the problem.
 *
 *  Throws when it will not go: a piece that silently became nothing is a hole in a
 *  transcript that nothing on screen accounts for. */
export async function heardPiece(
  wav: Uint8Array<ArrayBuffer>,
  /** Told each time a try fails, so the pill can say a piece is being tried again
   *  rather than a transcript quietly falling behind. */
  failed?: (round: number) => void,
): Promise<Words> {
  const token = account.accountToken
  if (!token) throw new Error(key('Sign in to turn a recording into words.'))

  let trouble: unknown = null

  for (let round = 1; round <= TRIES; round++) {
    try {
      const said = await api.askPiece(token, wav)
      return { text: said.said ?? '', language: said.language }
    } catch (error) {
      trouble = error
      failed?.(round)
      if (round < TRIES) await waited(roomDelay(round))
    }
  }

  throw new Error(message(trouble, key('That recording could not be turned into words.')))
}

/** A whole recording, as words.
 *
 *  The file is decoded here rather than sent as it stands. The route takes the one
 *  format both models are happiest with, and the browser already holds a decoder for
 *  every container it can record into - which is a thing a Worker does not. So what
 *  crosses the internet is the same WAV a spoken command crosses it as, and the file
 *  in the note stays the small modern container the platform wrote. */
export async function wordsInFile(bytes: ArrayBuffer): Promise<Words> {
  if (bytes.byteLength > MOST_DECODED) {
    throw new Error(key('That recording is too long to turn into words in one go.'))
  }

  const samples = await decoded(bytes)
  const parts = pieces(samples, RATE, FILE_SECONDS)

  const said: string[] = []
  let language = ''

  for (const part of parts) {
    const heard = await heardPiece(wavOf(part, RATE))
    if (heard.text) said.push(heard.text)
    // The first model to say. They are pieces of one recording, so the language the
    // first of them settled on is the language of all of them.
    if (!language) language = heard.language
  }

  return { text: said.join('\n\n'), language }
}

/** A file as samples at the rate the route listens at.
 *
 *  Decoded in a context that runs at 16 kHz, so the engine's own resampler does the
 *  work on the way out of the decoder rather than this doing it afterwards over an
 *  array forty-eight thousand samples a second long. Mixed to one channel, because a
 *  transcriber listens to one. */
async function decoded(bytes: ArrayBuffer): Promise<Float32Array> {
  // One frame: the context is here to decode, not to play, and its length has nothing
  // to do with the length of what it decodes.
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: RATE })

  // A copy, because decoding detaches the buffer it is given and the caller still
  // wants its own bytes to write to a file.
  const buffer = await context.decodeAudioData(bytes.slice(0))
  const channels: Float32Array[] = []
  for (let one = 0; one < buffer.numberOfChannels; one++) channels.push(buffer.getChannelData(one))

  // The rate is already what was asked for on every engine that honours it; resampling
  // answers the one that does not.
  return resampled(mono(channels), buffer.sampleRate, RATE)
}
