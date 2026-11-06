import { key } from '../i18n.svelte'
import { bestContainer, extensionOf } from './container'

const HANDOVER = 5_000

const PATIENCE = 20_000

export async function openMicrophone(): Promise<MediaStream> {
  let ran = 0

  try {
    return await Promise.race([
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
      new Promise<never>((_resolve, reject) => {
        ran = window.setTimeout(
          () => reject(new Error(key('That microphone could not be opened.'))),
          PATIENCE,
        )
      }),
    ])
  } finally {
    window.clearTimeout(ran)
  }
}

export const MOST_BYTES = 24 * 1024 * 1024

export interface Recording {
  extension: string
  stop: () => Promise<{ bytes: ArrayBuffer; seconds: number }>
}

export interface Listening {
  full?: () => void
}

export async function record(listening: Listening = {}): Promise<Recording> {
  const type = bestContainer()
  if (type === null) throw new Error('this build cannot record')

  const stream = await openMicrophone()

  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {})
  const chunks: Blob[] = []
  let held = 0
  let full = false

  const started = performance.now()

  const close = () => {
    for (const track of stream.getTracks()) track.stop()
  }

  recorder.ondataavailable = (event) => {
    if (!event.data.size) return

    chunks.push(event.data)
    held += event.data.size
    if (held <= MOST_BYTES || full) return

    full = true
    listening.full?.()
    if (recorder.state !== 'inactive') recorder.stop()
  }

  recorder.start(HANDOVER)

  return {
    get extension() {
      return extensionOf(recorder.mimeType || type)
    },
    stop: () =>
      new Promise((resolve) => {
        const done = () => {
          close()
          const kind = recorder.mimeType || type || 'audio/webm'
          void new Blob(chunks, { type: kind })
            .arrayBuffer()
            .then((bytes) => resolve({ bytes, seconds: (performance.now() - started) / 1000 }))
        }

        if (recorder.state === 'inactive') {
          done()
          return
        }

        recorder.onstop = done
        recorder.stop()
      }),
  }
}
