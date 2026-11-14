import type { FileRef } from '@orden/chats'
import { WAVE_BARS } from '@orden/chats/limits'

const GALLERY_MOST = 6

const PICTURE_TALLEST = 360
const PICTURE_WIDEST = 480

export function isPicture(file: FileRef): boolean {
  return file.type.startsWith('image/')
}

export function isVideo(file: FileRef): boolean {
  return file.type.startsWith('video/')
}

function isSound(file: FileRef): boolean {
  return file.type.startsWith('audio/')
}

export function sortFiles(files: readonly FileRef[]): {
  seen: FileRef[]
  heard: FileRef[]
  other: FileRef[]
} {
  return {
    seen: files.filter((one) => isPicture(one) || isVideo(one)),
    heard: files.filter(isSound),
    other: files.filter((one) => !isPicture(one) && !isVideo(one) && !isSound(one)),
  }
}

export function fitted(file: FileRef, column: number): { width: number; height: number } {
  const width = file.width ?? 0
  const height = file.height ?? 0
  const widest = Math.min(column, PICTURE_WIDEST)
  if (width <= 0 || height <= 0) {
    const side = Math.min(widest, 240)
    return { width: side, height: side }
  }
  const scale = Math.min(1, widest / width, PICTURE_TALLEST / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export function gallery(files: readonly FileRef[]): {
  across: number
  shown: FileRef[]
  more: number
} {
  const shown = files.slice(0, GALLERY_MOST)
  const across = shown.length === 2 || shown.length === 4 ? 2 : 3
  return { across, shown, more: files.length - shown.length }
}

export function barsOf(samples: Float32Array, bars = WAVE_BARS): number[] {
  if (samples.length === 0) return Array.from({ length: bars }, () => 0)
  const out: number[] = []
  const per = samples.length / bars
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor(bar * per)
    const to = Math.max(from + 1, Math.floor((bar + 1) * per))
    let sum = 0
    for (let i = from; i < to && i < samples.length; i++) sum += (samples[i] ?? 0) ** 2
    out.push(Math.sqrt(sum / (to - from)))
  }
  const loudest = out.reduce((high, one) => Math.max(high, one), -Infinity)
  return out.map((one) => (loudest > 0 ? Math.round((one / loudest) * 255) : 0))
}

export function seekAt(x: number, left: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(1, Math.max(0, (x - left) / width))
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
