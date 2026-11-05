/** The microphone as samples, for dictation: 16 kHz, one channel, in memory.
 *
 *  Not a file, which is what a recording is (recorder/microphone.ts). Dictation hears the
 *  sound while it is still being spoken - a stretch of it again and again as live words,
 *  and all of it once at the end - so it wants the samples themselves, at the rate the
 *  transcribers listen at, and they are never written anywhere.
 *
 *  Web Audio in every engine the app runs in: a context at 16 kHz, so the engine's own
 *  resampler does the work, and a script processor handing over a block at a time. The
 *  processor is the old node, deprecated and in every engine all the same; the new one, a
 *  worklet, is a module of its own built and fetched by address, for a block of 128 ms
 *  that costs the main thread nothing beside the request it is sent in. */

import { openMicrophone } from '../recorder/microphone'
import { RATE, resampled } from '../recorder/wav'

/** Samples a block: 2048 at 16 kHz is 128 ms, eight levels a second for the meter. */
const BLOCK = 2048

/** What dictation may grow to: five minutes, twenty megabytes of samples. Past it the
 *  caller is told and stops, keeping what it has. */
const MOST_SECONDS = 300

/** The microphone, open. */
export interface Capture {
  /** Every sample so far. A view of the store, valid until the next block arrives. */
  samples(): Float32Array
  /** Closes the microphone. What was heard stays readable. */
  stop(): void
}

/** Opens the microphone and hands each block over as it arrives.
 *
 *  `heard` is called once a block with the samples so far; `full` once, when the
 *  ceiling above is reached, after which nothing more is kept. Throws where there is no
 *  microphone or the reader refused it, with the platform's own error. */
export async function capture(
  heard: (samples: Float32Array) => void,
  full: () => void,
): Promise<Capture> {
  const stream = await openMicrophone()
  try {
    return await listening(stream, heard, full)
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    throw error
  }
}

/** A context at 16 kHz where the engine will run one, and at its own rate where it will
 *  not, the blocks resampled on the way in. */
function contextAtRate(): AudioContext {
  try {
    return new AudioContext({ sampleRate: RATE })
  } catch {
    return new AudioContext()
  }
}

async function listening(
  stream: MediaStream,
  heard: (samples: Float32Array) => void,
  full: () => void,
): Promise<Capture> {
  const context = contextAtRate()

  /* eslint-disable @typescript-eslint/no-deprecated -- the script processor, above */
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(BLOCK, 1, 1)
  // Silent, and connected only because a processor that leads nowhere is never run.
  const mute = context.createGain()
  mute.gain.value = 0

  let store = new Float32Array(RATE * 10)
  let length = 0
  let stopped = false
  const most = RATE * MOST_SECONDS

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    if (stopped) return
    const raw = event.inputBuffer.getChannelData(0)
    const block = context.sampleRate === RATE ? raw : resampled(raw, context.sampleRate, RATE)
    if (length + block.length > most) {
      stopped = true
      full()
      return
    }
    if (length + block.length > store.length) {
      const grown = new Float32Array(Math.min(most, store.length * 2))
      grown.set(store.subarray(0, length))
      store = grown
    }
    store.set(block, length)
    length += block.length
    heard(store.subarray(0, length))
  }

  source.connect(processor)
  processor.connect(mute)
  mute.connect(context.destination)
  // A context made outside a press starts suspended in WebKit.
  if (context.state === 'suspended') await context.resume().catch(() => undefined)

  return {
    samples: () => store.subarray(0, length),
    stop: () => {
      stopped = true
      processor.onaudioprocess = null
      source.disconnect()
      processor.disconnect()
      mute.disconnect()
      for (const track of stream.getTracks()) track.stop()
      void context.close().catch(() => undefined)
    },
  }
  /* eslint-enable @typescript-eslint/no-deprecated */
}
