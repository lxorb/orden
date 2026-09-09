import { englishLabel, LABEL_KEYS, setLabels } from '@nib/editor'
import { de } from '../locales/de'
import { fr } from '../locales/fr'
import { gsw } from '../locales/gsw'
import { ja } from '../locales/ja'

/** The English string is its own key. A language that has not translated
 *  something falls back to it, so nothing can ever come out blank. */
export type Dictionary = Record<string, string>

export const LANGUAGES = [
  { id: 'system', name: 'Match the system' },
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'gsw', name: 'Schwiizerdütsch' },
  { id: 'fr', name: 'Français' },
  { id: 'ja', name: '日本語' },
] as const

const DICTIONARIES: Record<string, Dictionary> = { de, gsw, fr, ja }

const STORAGE_KEY = 'nib:language'

function systemLanguage(): string {
  return (navigator.language || 'en').slice(0, 2).toLowerCase()
}

class I18n {
  /** `system`, or a language chosen explicitly. */
  choice = $state('system')

  readonly language = $derived(this.choice === 'system' ? systemLanguage() : this.choice)
  private readonly dictionary = $derived(DICTIONARIES[this.language] ?? {})

  restore() {
    this.choice = localStorage.getItem(STORAGE_KEY) ?? 'system'
    document.documentElement.lang = this.language
    this.translateEditor()
  }

  select(id: string) {
    this.choice = id
    localStorage.setItem(STORAGE_KEY, id)
    document.documentElement.lang = this.language
    this.translateEditor()
  }

  /** The editor package has its own handful of labels; hand it ours. */
  private translateEditor() {
    setLabels(Object.fromEntries(LABEL_KEYS.map((key) => [key, this.t(englishLabel(key))])))
  }

  /** Translates one string, filling in `{name}` placeholders. */
  t(text: string, values?: Record<string, string | number>): string {
    const translated = this.dictionary[text] ?? text
    if (!values) return translated

    // Only what was handed over: every object inherits `toString` and
    // `constructor`, and reading a placeholder off the prototype would put the
    // source of a function on screen.
    return translated.replace(/\{(\w+)\}/g, (whole, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : whole,
    )
  }
}

export const i18n = new I18n()

/** Whatever was thrown, as a translated sentence. Server messages arrive in
 *  English, so they are looked up like any other string and fall back to
 *  themselves when a dictionary has nothing for them. */
export function message(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : ''
  return t(text || fallback)
}

/** Marks a string that something further along will translate. It hands the
 *  text back unchanged; the point is that the dictionaries and the check that
 *  guards them can both see it. */
export const key = (text: string) => text

/** Shorthand, so a component reads `{t('Save')}` rather than `{i18n.t('Save')}`. */
export const t = (text: string, values?: Record<string, string | number>) => i18n.t(text, values)
