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

function padded(value: number): string {
  return String(value).padStart(2, '0')
}

export function recordingName(at: Date, extension: string): string {
  const stamp = [
    at.getFullYear(),
    padded(at.getMonth() + 1),
    padded(at.getDate()),
    `${padded(at.getHours())}${padded(at.getMinutes())}`,
  ].join('-')

  return `recording-${stamp}.${extension}`
}
