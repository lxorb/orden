import { todayOf } from '@orden/bases'
import { clockOf } from './transcript'

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
export function extensionOf(type: string): string {
  const family = type.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXTENSIONS[family] ?? 'weba'
}
export function bestContainer(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return CONTAINERS.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}
export function canRecordHere(): boolean {
  const devices: MediaDevices | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  return !!devices && bestContainer() !== null
}
export function recordingName(at: Date, extension: string): string {
  return `recording-${todayOf(at)}-${clockOf(at)}.${extension}`
}
