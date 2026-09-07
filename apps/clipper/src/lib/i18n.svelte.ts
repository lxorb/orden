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

function systemLanguage(): string {
  return (navigator.language || 'en').slice(0, 2).toLowerCase()
}

class I18n {
  /** `system`, or a language chosen explicitly. */
  choice = $state('system')

  readonly language = $derived(this.choice === 'system' ? systemLanguage() : this.choice)
  private readonly dictionary = $derived(DICTIONARIES[this.language] ?? {})

  /** Called once with what the settings hold, before anything is drawn. */
  use(choice: string) {
    this.choice = choice
    if (typeof document !== 'undefined') document.documentElement.lang = this.language
  }

  /** Translates one string, filling in `{name}` placeholders. */
  t(source: string, values?: Record<string, string | number>): string {
    const translated = this.dictionary[source] ?? source
    if (!values) return translated

    return translated.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? String(values[name]) : whole,
    )
  }
}

export const i18n = new I18n()

/** Shorthand, so markup reads `{t('Save')}` rather than `{i18n.t('Save')}`. */
export const t = (source: string, values?: Record<string, string | number>) =>
  i18n.t(source, values)

/** Whatever was thrown, as a translated sentence. The sync service answers in
 *  English, so its words are looked up like any other string and fall back to
 *  themselves when a dictionary has nothing for them. */
export function message(error: unknown, fallback: string): string {
  const said = error instanceof Error ? error.message : ''
  return t(said || fallback)
}
