import type { ChatPoke } from '@orden/chats/wire'

export const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

const MOST_FRAME = 4096

const MOST_NAME = 120
const MOST_PLATFORM = 24
const MOST_APP = 32

export type FromDevice =
  | { t: 'hello'; device: string; name: string; platform: string; app: string }
  | { t: 'active' }
  | { t: 'idle' }

export type FromHub =
  | { t: 'poke'; space: string; seq: number }
  | { t: 'machine'; state: 'asleep' | 'starting' | 'awake' | 'stopping' }
  | { t: 'terms' }
  | { t: 'ai' }
  | ChatPoke

type Fields = Record<string, unknown>

const text = (fields: Fields, name: string, most: number): string | null => {
  const value = fields[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= most ? trimmed : null
}

const matching = (fields: Fields, name: string, shape: RegExp): string | null => {
  const value = fields[name]
  return typeof value === 'string' && shape.test(value) ? value : null
}

export function readFrame(said: string): FromDevice | null {
  if (said.length > MOST_FRAME) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(said)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const fields = parsed as Fields
  switch (fields.t) {
    case 'active':
    case 'idle':
      return { t: fields.t }

    case 'hello': {
      const device = matching(fields, 'device', DEVICE)
      const name = text(fields, 'name', MOST_NAME)
      const platform = text(fields, 'platform', MOST_PLATFORM)
      const app = text(fields, 'app', MOST_APP)
      if (!device || !name || !platform || !app) return null
      return { t: 'hello', device, name, platform, app }
    }

    default:
      return null
  }
}

export function say(socket: WebSocket, frame: FromHub): void {
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // Closing or closed: see above.
  }
}
