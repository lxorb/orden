import { todayOf } from '@orden/bases'
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

export function transcriptCallout(text: string, language: string, model: string): string {
  return [
    `> [!quote] Transcript${language ? ` (${language})` : ''}`,
    `> ${writtenBy(model)}`,
    '>',
    ...text.split('\n').map((line) => (line ? `> ${line}` : '>')),
  ].join('\n')
}

export function clockOf(at: Date): string {
  const hour = String(at.getHours()).padStart(2, '0')
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${hour}${minute}`
}

export function recordingNoteName(at: Date): string {
  return `Recording ${todayOf(at)} ${clockOf(at)}`
}
