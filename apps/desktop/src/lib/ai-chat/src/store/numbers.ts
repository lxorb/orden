const made = new Map<string, Intl.NumberFormat>()

function formatter(language: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${language} ${JSON.stringify(options)}`
  const held = made.get(key)
  if (held) return held
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat(language, options)
  } catch {
    format = new Intl.NumberFormat('en', options)
  }
  made.set(key, format)
  return format
}

export function tokens(count: number, language: string): string {
  const leading = count >= 1_000_000 ? count / 1_000_000 : count / 1_000
  return formatter(language, {
    notation: 'compact',
    maximumFractionDigits: count >= 1_000 && leading < 10 ? 1 : 0,
  }).format(Math.max(0, Math.round(count)))
}

export function minutes(ms: number, language: string): string {
  return formatter(language, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'narrow',
  }).format(Math.max(0, Math.floor(ms / 60_000)))
}

export function seconds(ms: number, language: string): string {
  return formatter(language, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
  }).format(Math.max(1, Math.round(ms / 1000)))
}

export function lasted(ms: number, language: string): string {
  const whole = Math.max(1, Math.round(ms / 1000))
  if (whole < 60) return seconds(whole * 1000, language)
  const left = whole % 60
  const counted = minutes(whole * 1000, language)
  return left ? `${counted} ${seconds(left * 1000, language)}` : counted
}
