import { formatWikilink } from '@orden/markdown/links'

export function embedFor(name: string): string {
  return formatWikilink({ target: name, heading: null, block: null, alias: null, embed: true })
}

export function languageName(code: string, locale: string): string {
  const tidy = code.trim().toLowerCase()
  if (!tidy) return ''

  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tidy) ?? tidy
  } catch {
    return tidy
  }
}

export function writtenBy(model: string): string {
  return `*Written by ${model}*`
}

function heading(language: string): string {
  return language ? `Transcript (${language})` : 'Transcript'
}

function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

export function transcriptCallout(text: string, language: string, model: string): string {
  return [`> [!quote] ${heading(language)}`, `> ${writtenBy(model)}`, '>', quoted(text)].join('\n')
}

export function spanOf(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60) % 60
  const hours = Math.floor(whole / 3600)
  const rest = String(whole % 60).padStart(2, '0')

  if (!hours) return `${minutes}:${rest}`
  return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
}

export function dayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

export function clockOf(at: Date): string {
  const hour = String(at.getHours()).padStart(2, '0')
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${hour}${minute}`
}

export function recordingNoteName(at: Date): string {
  return `Recording ${dayOf(at)} ${clockOf(at)}`
}
