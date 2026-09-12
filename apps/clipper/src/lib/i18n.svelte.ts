/** The language the two pages are drawn in.
 *
 *  A rune around `translate.ts` and nothing else: the choice is state, so every
 *  `{t('…')}` in the markup redraws when the options page changes it. The
 *  service worker translates without this, because a worker has no markup to
 *  redraw and Svelte's client runtime is most of what it would have to load; see
 *  the header of `translate.ts`. */

import {
  catalogueOf,
  type Dictionary,
  directionOf,
  fill,
  LANGUAGES,
  languageOf,
  pick,
  type Plural,
  say,
} from './translate'

/** Built once per language and kept: a formatter is most of what formatting a
 *  number costs, and the popup formats one for every character it has sent. */
/* eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing draws this
   map; the fields that read it draw themselves, and a reactive one would make
   every formatted number a dependency of the cache it came out of. */
const numbers = new Map<string, Intl.NumberFormat>()

function numberFormat(language: string): Intl.NumberFormat {
  const kept = numbers.get(language)
  if (kept) return kept

  const made = new Intl.NumberFormat(language)
  numbers.set(language, made)
  return made
}

class I18n {
  /** `system`, or a language chosen explicitly. */
  choice = $state('system')

  /** What is on screen right now. Empty until the catalogue lands, and empty is
   *  English: every string is its own key, so nothing is blank on the way. */
  private catalogue = $state<Dictionary>({})

  /** The catalogue in force, which is also the tag `Intl` is asked in: the
   *  extension's language rather than the browser's, so somebody reading a German
   *  popup in an English Chrome reads German numbers. */
  readonly language = $derived(languageOf(this.choice))

  /** Whether what is on screen was written in one pass and never read through.
   *  The options page says so under the row, with somewhere to send a
   *  correction. */
  readonly machine = $derived(
    LANGUAGES.some((one) => one.id === this.language && one.machine === true),
  )

  /** Called once with what storage holds, before anything is drawn, and again
   *  whenever somebody chooses another language.
   *
   *  Awaited by both pages: they read storage before their first frame anyway, so
   *  the catalogue lands in the same breath and the popup opens already in the
   *  right language rather than flashing into it.
   *
   *  A second choice made while the first is still on its way wins: an answer
   *  that arrives for a language nobody is waiting for any more is dropped. */
  async use(choice: string): Promise<void> {
    this.choice = choice
    const wanted = this.language
    // `dir` beside `lang`: which way the pages read is a fact about the language,
    // and one attribute is what every mirroring rule in the shared stylesheets
    // keys off; see translate.ts.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = wanted
      document.documentElement.dir = directionOf(wanted)
    }

    const next = await catalogueOf(wanted)
    if (this.language !== wanted) return

    this.catalogue = next
  }

  /** Translates one string, filling in `{name}` placeholders. */
  t(source: string, values?: Record<string, string | number>): string {
    return say(this.catalogue, source, values)
  }

  /** One of the forms a count wants, in the language's own shape: English has
   *  two, Polish four and Arabic six, and which one a number takes is
   *  `Intl.PluralRules`'s answer rather than a comparison with 1.
   *
   *  A catalogue holding one string for the row is a language with one form,
   *  which is most of East and Southeast Asia. */
  plural(count: number, forms: Plural, values?: Record<string, string | number>): string {
    const found = this.catalogue[forms.other]
    const translated =
      typeof found === 'string'
        ? found
        : found
          ? pick(count, this.language, found)
          : pick(count, 'en', forms)

    return fill(translated || forms.other, { count, ...values })
  }

  /** A number with the language's own grouping and digits. */
  amount(value: number): string {
    return numberFormat(this.language).format(value)
  }
}

export const i18n = new I18n()

/** Shorthand, so markup reads `{t('Save')}` rather than `{i18n.t('Save')}`. */
export const t = (source: string, values?: Record<string, string | number>) =>
  i18n.t(source, values)

/** Shorthand for a count: `plural(n, { one: '{count} clip', other: '{count} clips' })`.
 *  The `other` form is the row every catalogue holds. */
export const plural = (
  count: number,
  forms: Plural,
  values?: Record<string, string | number>,
): string => i18n.plural(count, forms, values)

/** Shorthand for a number in the extension's language. */
export const amount = (value: number): string => i18n.amount(value)

/** Whatever was thrown, as a translated sentence. The sync service answers in
 *  English, so its words are looked up like any other string and fall back to
 *  themselves when a dictionary has nothing for them. */
export function message(error: unknown, fallback: string): string {
  const said = error instanceof Error ? error.message : ''
  return t(said || fallback)
}
