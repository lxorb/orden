/** The languages a note's spelling is checked in, several at once (#771).
 *
 *  A reader on a NixOS laptop: *"spellchecking for multiple languages"*. The spelling
 *  pane had one dropdown, and what it set was the writing surface's `lang` - which no
 *  Chromium reads to choose a dictionary. Chromium checks a word against every
 *  dictionary in its `spellcheck.dictionaries` preference, and nib never wrote that, so
 *  on nib's own Chromium every note was checked in English whatever the pane said
 *  (measured: the profile held `["en-US"]` and one `en-US-10-2.bdic`).
 *
 *  So on nib's own Chromium, which is every Linux desktop, the pane is a switch per
 *  dictionary and the crate writes the ones that are on into that preference; Chromium
 *  fetches a dictionary it has not got the first time it is asked for. The other
 *  engines check in the languages their platform is set to, several at once already -
 *  Windows' own checker in WebView2, the Mac's in WebKit, a browser's in a browser - and
 *  have no such list to write, so the pane says so rather than offering switches that
 *  would turn nothing. */

import { i18n } from './i18n.svelte'
import { invoke, isDesktop, platform } from './tauri'

/** A dictionary Chromium has, by the tag its preference names it with, and named the
 *  way its speakers name it, so the row reads the same whatever the app's language. In
 *  the order every language list keeps (language-order.ts), which a test holds it to. */
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

/** Whether this engine checks against a list nib can write: nib's own Chromium, which
 *  every Linux desktop runs. */
export const choosable = isDesktop && platform() === 'linux'

/** The dictionary a language tag reads best in: the tag itself where there is one, else
 *  its language in the region the reader's own languages name - `en` on a machine set
 *  to `en-US` reads in `en-US` - else the first of its language, and English where there
 *  is none, which is what Chromium itself starts on. */
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

/** What is checked in: what was chosen, or where nothing was, the reader's own
 *  language. Never nothing - turning spelling off is the switch above for that. */
export function inForce(
  chosen: readonly string[],
  language: string,
  preferred: readonly string[] = [],
): string[] {
  const kept = chosen.filter((one) => KNOWN.has(one))
  return kept.length ? kept : [dictionaryFor(language, preferred)]
}

/** The dictionaries in force now: what was chosen - an older build's one short tag
 *  among it, `de`, read as the dictionary it names - else the app's own language. */
export function inForceNow(chosen: readonly string[]): string[] {
  const preferred = machineLanguages()
  return inForce(
    chosen.map((one) => (KNOWN.has(one) ? one : dictionaryFor(one, preferred))),
    i18n.language,
    preferred,
  )
}

/** The chosen list with one dictionary turned on or off, in the list's own order. The
 *  last one on stays on: a checker with no language is the switch for spelling, not
 *  this; null where nothing would change. */
export function toggled(chosen: readonly string[], id: string, on: boolean): string[] | null {
  const now = inForceNow(chosen)
  const next = on ? [...now, id] : now.filter((one) => one !== id)
  if (!next.length || (on && now.includes(id))) return null
  return DICTIONARIES.map((one) => one.id).filter((one) => next.includes(one))
}

/** The languages the machine says its reader reads, best first; none outside a page. */
export function machineLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages
}

/** The chosen list read off storage: only the tags this list knows, once each. */
export function chosenOf(saved: unknown): string[] {
  if (!Array.isArray(saved)) return []
  return [
    ...new Set(saved.filter((one): one is string => typeof one === 'string' && KNOWN.has(one))),
  ]
}

/** Tells the engine which dictionaries to check against, where it is one that has a
 *  list; see the top of this file and `spell_languages` in src-tauri/src/spelling.rs. */
export function tellEngine(languages: readonly string[]): void {
  if (!choosable) return
  void invoke('spell_languages', { languages }).catch(() => undefined)
}
