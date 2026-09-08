/** The language the two pages are drawn in.
 *
 *  A rune around `translate.ts` and nothing else: the choice is state, so every
 *  `{t('…')}` in the markup redraws when the options page changes it. The
 *  service worker translates without this, because a worker has no markup to
 *  redraw and Svelte's client runtime is most of what it would have to load; see
 *  the header of `translate.ts`. */

import { languageOf, translate } from './translate'

class I18n {
  /** `system`, or a language chosen explicitly. */
  choice = $state('system')

  /** Called once with what the settings hold, before anything is drawn, and
   *  again whenever somebody chooses another language. */
  use(choice: string) {
    this.choice = choice
    if (typeof document !== 'undefined') document.documentElement.lang = languageOf(choice)
  }

  /** Translates one string, filling in `{name}` placeholders. */
  t(source: string, values?: Record<string, string | number>): string {
    return translate(this.choice, source, values)
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
