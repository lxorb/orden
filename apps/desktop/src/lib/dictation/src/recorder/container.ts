import { clockOf, dayOf } from './transcript'

const CONTAINERS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const

const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/webm': 'weba',
  'audio/ogg': 'oga',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

const FALLBACK = 'weba'

export function extensionOf(type: string): string {
  const family = type.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXTENSIONS[family] ?? FALLBACK
}

export function bestContainer(): string | null {
  if (typeof MediaRecorder === 'undefined') return null

  for (const type of CONTAINERS) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }

  return ''
}

export function canRecordHere(): boolean {
  const devices: MediaDevices | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.mediaDevices

  return !!devices && bestContainer() !== null
}

export function recordingName(at: Date, extension: string): string {
  return `recording-${dayOf(at)}-${clockOf(at)}.${extension}`
}
