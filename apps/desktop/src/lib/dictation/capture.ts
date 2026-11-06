import { openMicrophone } from '../recorder/microphone'
import { RATE, resampled } from '../recorder/wav'

const BLOCK = 2048

const MOST_SECONDS = 300

export interface Capture {
  samples(): Float32Array
  stop(): void
}

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
