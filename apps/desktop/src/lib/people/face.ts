import { BASE } from '../api'

export interface Avatar {
  s: string
  l: string
}

export interface Status {
  emoji: string
  text: string
  until: number | null
  quiet: boolean
}

export type Presence = 'active' | 'away' | 'offline'

export interface Face {
  name: string
  avatar?: Avatar | null
  accent?: string | null
  key?: string
}

const HASH = /^[a-f0-9]{64}$/

export function faceUrl(hash: string | null | undefined): string | null {
  return hash && HASH.test(hash) ? `${BASE}/i/${hash}.webp` : null
}
