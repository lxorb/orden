import { isRecord } from '../stored'

export const BEAT = 'beat'
export const BEAT_ANSWER = 'ok'

export const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

export type FromDevice =
  | { t: 'hello'; device: string; name: string; platform: string; app: string }
  | { t: 'active' }
  | { t: 'idle' }

export type FromHub =
  | { t: 'poke'; space: string; seq: number }
  | { t: 'terms' }
  | { t: 'ai' }
  | { t: 'chat'; said: Record<string, unknown> }

export type HubType = FromHub['t']

export type HubFrame<T extends HubType> = Extract<FromHub, { t: T }>

const text = (value: unknown): value is string => typeof value === 'string'
const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function readHubFrame(said: string): FromHub | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(said)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const one = parsed
  switch (one.t) {
    case 'poke':
      return text(one.space) && whole(one.seq)
        ? { t: 'poke', space: one.space, seq: one.seq }
        : null

    case 'terms':
      return { t: 'terms' }

    case 'ai':
      return { t: 'ai' }

    case 'chat':
      return { t: 'chat', said: one }

    default:
      return null
  }
}
