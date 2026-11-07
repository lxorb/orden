import { endingOf } from './order'

export type Shown = 'picture' | 'sound' | 'film' | 'text' | null

const KINDS: Record<string, { shown: Exclude<Shown, 'text' | null>; type: string }> = {
  png: { shown: 'picture', type: 'image/png' },
  jpg: { shown: 'picture', type: 'image/jpeg' },
  jpeg: { shown: 'picture', type: 'image/jpeg' },
  gif: { shown: 'picture', type: 'image/gif' },
  webp: { shown: 'picture', type: 'image/webp' },
  avif: { shown: 'picture', type: 'image/avif' },
  bmp: { shown: 'picture', type: 'image/bmp' },
  ico: { shown: 'picture', type: 'image/x-icon' },
  svg: { shown: 'picture', type: 'image/svg+xml' },
  mp3: { shown: 'sound', type: 'audio/mpeg' },
  m4a: { shown: 'sound', type: 'audio/mp4' },
  wav: { shown: 'sound', type: 'audio/wav' },
  ogg: { shown: 'sound', type: 'audio/ogg' },
  oga: { shown: 'sound', type: 'audio/ogg' },
  flac: { shown: 'sound', type: 'audio/flac' },
  opus: { shown: 'sound', type: 'audio/ogg' },
  mp4: { shown: 'film', type: 'video/mp4' },
  m4v: { shown: 'film', type: 'video/mp4' },
  webm: { shown: 'film', type: 'video/webm' },
  mov: { shown: 'film', type: 'video/quicktime' },
}

export const MOST_TEXT = 64 * 1024
export const MOST_MEDIA = 48 * 1024 * 1024

export function shownAs(name: string, size: number): Shown {
  const known = KINDS[endingOf(name)]
  if (known) return size <= MOST_MEDIA ? known.shown : null
  return 'text'
}

export function mediaUrl(name: string, read: { bytes: Uint8Array; cut: boolean }): string | null {
  const known = KINDS[endingOf(name)]
  if (!known || read.cut) return null
  return URL.createObjectURL(new Blob([read.bytes.slice().buffer], { type: known.type }))
}

export function pictureUrl(name: string, read: { bytes: Uint8Array; cut: boolean }): string | null {
  return KINDS[endingOf(name)]?.shown === 'picture' ? mediaUrl(name, read) : null
}

export function textOf(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    const cut = bytes.length >= MOST_TEXT ? lastWhole(bytes) : null
    if (cut === null) return null
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, cut))
    } catch {
      return null
    }
  }
}

function lastWhole(bytes: Uint8Array): number | null {
  for (let at = bytes.length; at > bytes.length - 4 && at > 0; at--) {
    const byte = bytes[at - 1] ?? 0
    if (byte < 0x80) return at
    if (byte >= 0xc0) return at - 1
  }
  return null
}
