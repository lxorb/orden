export interface Step {
  value: number
  unit: Intl.RelativeTimeFormatUnit
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function relativeStep(elapsed: number): Step {
  if (elapsed < MINUTE) {
    const seconds = Math.max(0, Math.round(elapsed / SECOND))
    return { value: seconds === 0 ? 0 : -seconds, unit: 'second' }
  }

  if (elapsed < HOUR) return { value: -Math.round(elapsed / MINUTE), unit: 'minute' }
  if (elapsed < DAY) return { value: -Math.round(elapsed / HOUR), unit: 'hour' }

  return { value: -Math.round(elapsed / DAY), unit: 'day' }
}

const formats = new Map<string, Intl.RelativeTimeFormat>()

export function agoShort(at: number, language: string, now = Date.now()): string {
  let format = formats.get(language)
  if (!format) {
    try {
      format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'narrow' })
    } catch {
      format = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' })
    }
    formats.set(language, format)
  }
  const step = relativeStep(now - at)
  return format.format(step.value, step.unit)
}
