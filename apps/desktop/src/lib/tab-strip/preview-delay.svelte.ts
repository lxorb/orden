import { keep, storedText } from '../platform/src/api'

const KEY = 'orden:tab-preview-delay'

export const PREVIEW_DELAY = { initial: 500, least: 0, most: 2000, step: 100 } as const

function readDelay(text: string | null): number {
  const value = text === null ? Number.NaN : Number(text)
  if (!Number.isFinite(value)) return PREVIEW_DELAY.initial
  return Math.min(PREVIEW_DELAY.most, Math.max(PREVIEW_DELAY.least, Math.round(value)))
}

class PreviewDelay {
  ms = $state(readDelay(storedText(KEY)))

  set(value: number) {
    this.ms = readDelay(String(value))
    keep(KEY, String(this.ms))
  }
}

export const previewDelay = new PreviewDelay()
