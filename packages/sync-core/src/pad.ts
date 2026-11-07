import type { Edit } from './merge3'
import { edits } from './diff'

export const MOST_PAD_BYTES = 1024 * 1024

export interface PadTrade {
  sv: Uint8Array
  update: Uint8Array
}

export type PadAnswer = PadTrade

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const CHUNK = 0x8000

export function padBase64(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }
  return btoa(text)
}

function bytesOf(value: unknown, most: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length > Math.ceil((most * 4) / 3) + 4) return null
  try {
    const text = atob(value)
    const bytes = new Uint8Array(text.length)
    for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at)
    return bytes
  } catch {
    return null
  }
}

export function padTradeOf(body: unknown): PadTrade | null {
  if (!isRecord(body)) return null
  const sv = bytesOf(body.sv, MOST_PAD_BYTES)
  const update = bytesOf(body.update ?? '', 2 * MOST_PAD_BYTES)
  return sv && update ? { sv, update } : null
}

export function padBytes(text: string): Uint8Array | null {
  return bytesOf(text, Number.MAX_SAFE_INTEGER)
}

export function padWire(trade: PadTrade): { sv: string; update: string } {
  return { sv: padBase64(trade.sv), update: padBase64(trade.update) }
}

export function padEdits(before: string, after: string): Edit[] {
  return edits(before, after, 'operations')
}
