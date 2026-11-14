import { systemLocale, invoke, isDesktop, platform } from './platform/src/api'

interface Dictionary {
  id: string
  name: string
}

export const DICTIONARIES: readonly Dictionary[] = [
  { id: 'da-DK', name: 'Dansk' },
  { id: 'de-DE', name: 'Deutsch' },
  { id: 'en-GB', name: 'English (UK)' },
  { id: 'en-US', name: 'English (US)' },
  { id: 'es-ES', name: 'Español' },
  { id: 'fr-FR', name: 'Français' },
  { id: 'it-IT', name: 'Italiano' },
  { id: 'nl-NL', name: 'Nederlands' },
  { id: 'nb-NO', name: 'Norsk bokmål' },
  { id: 'pl-PL', name: 'Polski' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'pt-PT', name: 'Português (Portugal)' },
  { id: 'sv-SE', name: 'Svenska' },
  { id: 'tr-TR', name: 'Türkçe' },
  { id: 'ru-RU', name: 'Русский' },
  { id: 'uk-UA', name: 'Українська' },
]

const KNOWN = new Set(DICTIONARIES.map((one) => one.id))

export const choosable = isDesktop && platform() === 'linux'

export function dictionaryFor(tag: string, preferred: readonly string[] = []): string {
  const exact = (one: string) =>
    DICTIONARIES.find((dictionary) => dictionary.id.toLowerCase() === one.toLowerCase())?.id
  const language = (one: string) => one.split('-')[0]?.toLowerCase() ?? ''

  const asked = exact(tag)
  if (asked) return asked
  for (const one of preferred) {
    const found = language(one) === language(tag) ? exact(one) : undefined
    if (found) return found
  }
  return DICTIONARIES.find((one) => language(one.id) === language(tag))?.id ?? 'en-US'
}

export function inForce(
  chosen: readonly string[],
  language: string,
  preferred: readonly string[] = [],
): string[] {
  const kept = chosen.filter((one) => KNOWN.has(one))
  return kept.length ? kept : [dictionaryFor(language, preferred)]
}

export function inForceNow(chosen: readonly string[]): string[] {
  const preferred = machineLanguages()
  return inForce(
    chosen.map((one) => (KNOWN.has(one) ? one : dictionaryFor(one, preferred))),
    systemLocale(),
    preferred,
  )
}

export function toggled(chosen: readonly string[], id: string, on: boolean): string[] | null {
  const now = inForceNow(chosen)
  const next = on ? [...now, id] : now.filter((one) => one !== id)
  if (!next.length || (on && now.includes(id))) return null
  return DICTIONARIES.map((one) => one.id).filter((one) => next.includes(one))
}

export function machineLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages
}

export function chosenOf(saved: unknown): string[] {
  if (!Array.isArray(saved)) return []
  return [
    ...new Set(saved.filter((one): one is string => typeof one === 'string' && KNOWN.has(one))),
  ]
}

export function tellEngine(languages: readonly string[]): void {
  if (!choosable) return
  void invoke('spell_languages', { languages }).catch(() => undefined)
}
