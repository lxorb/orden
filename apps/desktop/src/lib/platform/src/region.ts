const dates = new Map<string, Intl.DateTimeFormat>()
const numbers = new Map<string, Intl.NumberFormat>()

let read: { system: string; region: string } | null = null

export const systemLocale = (): string => new Intl.DateTimeFormat().resolvedOptions().locale

export function englishFor(system: string): string {
  let country: string | undefined
  try {
    country = new Intl.Locale(system).maximize().region
  } catch {
    country = undefined
  }
  const hourCycle = new Intl.DateTimeFormat(system, { hour: 'numeric' }).resolvedOptions().hourCycle
  const base = country ? `en-${country}` : 'en'
  return hourCycle ? `${base}-u-hc-${hourCycle}` : base
}

export function region(): string {
  const system = systemLocale()
  if (read?.system !== system) read = { system, region: englishFor(system) }
  return read.region
}

export function localDate(at: Date | number, options: Intl.DateTimeFormatOptions): string {
  const asked = `${region()} ${JSON.stringify(options)}`
  let made = dates.get(asked)
  if (!made) {
    made = new Intl.DateTimeFormat(region(), options)
    dates.set(asked, made)
  }
  return made.format(at)
}

export function localNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const asked = `${region()} ${JSON.stringify(options)}`
  let made = numbers.get(asked)
  if (!made) {
    made = new Intl.NumberFormat(region(), options)
    numbers.set(asked, made)
  }
  return made.format(value)
}

export function midnightOf(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function elapsed(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60) % 60
  const hours = Math.floor(whole / 3600)
  const rest = String(whole % 60).padStart(2, '0')
  if (!hours) return `${minutes}:${rest}`
  return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
}
