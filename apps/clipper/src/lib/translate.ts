/** The words the extension can say, and which language it says them in.
 *
 *  A plain module on purpose. The service worker draws the three menu titles and
 *  one sentence in the toolbar's tooltip, and Chrome stops it between clips, so
 *  every clip from a shortcut or the page's own menu is a cold start: reaching
 *  the dictionaries through a rune would put Svelte's whole client runtime in
 *  front of it. The pages, which do need a language to change under them, wrap
 *  this in `i18n.svelte.ts`. */

import { de } from '../locales/de'
import { fr } from '../locales/fr'
import { gsw } from '../locales/gsw'
import { ja } from '../locales/ja'

/** The English string is its own key. A language that has not translated
 *  something falls back to it, so nothing can ever come out blank. */
export type Dictionary = Record<string, string>

/** The same list the app offers, in the same order, so the two settings pages
 *  read alike. See `apps/desktop/src/lib/i18n.svelte.ts`.
 *
 *  Chrome's own `_locales` is not what carries these: it has no Swiss German,
 *  and it picks by the browser's UI language rather than by what somebody
 *  chose. Only the handful of words Chrome itself draws - the tile on
 *  chrome://extensions and the shortcut list - come from `public/_locales`. */
export const LANGUAGES = [
  { id: 'system', name: 'Match the system' },
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'gsw', name: 'Schwiizerdütsch' },
  { id: 'fr', name: 'Français' },
  { id: 'ja', name: '日本語' },
] as const

const DICTIONARIES: Record<string, Dictionary> = { de, gsw, fr, ja }

/** The language a choice means. `system` is whatever the browser is set to,
 *  which a service worker can read as well as a page can. */
export function languageOf(choice: string): string {
  if (choice !== 'system') return choice
  return (navigator.language || 'en').slice(0, 2).toLowerCase()
}

/** One string in the language a choice means, with `{name}` placeholders filled
 *  in. */
export function translate(
  choice: string,
  source: string,
  values?: Record<string, string | number>,
): string {
  const translated = DICTIONARIES[languageOf(choice)]?.[source] ?? source
  if (!values) return translated

  return translated.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}
