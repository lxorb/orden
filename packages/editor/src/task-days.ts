import { label } from './labels'

const languageOf = () =>
  typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined

const dayNumber = (iso: string) => {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

const momentOf = (iso: string, time = '00:00') => {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes)
}

const said = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(languageOf(), options).format(momentOf(iso))

export function timeWords(time: string): string {
  return new Intl.DateTimeFormat(languageOf(), { hour: 'numeric', minute: '2-digit' }).format(
    momentOf('2000-01-01', time),
  )
}

export function todayHere(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function dayWords(iso: string, today: string, time?: string): string {
  const ahead = dayNumber(iso) - dayNumber(today)
  let day: string
  if (ahead === 0) day = label('today')
  else if (ahead === 1) day = label('tomorrow')
  else if (ahead === -1) day = label('yesterday')
  else if (ahead > 1 && ahead < 7) day = said(iso, { weekday: 'short' })
  else if (iso.slice(0, 4) === today.slice(0, 4))
    day = said(iso, { day: 'numeric', month: 'short' })
  else day = said(iso, { day: 'numeric', month: 'short', year: 'numeric' })
  return time ? `${day} ${timeWords(time)}` : day
}
