/** Which language the *panel* is written in.
 *
 *  The app has thirty-nine interface catalogues. The firmware has one font, and that
 *  font draws Latin, Cyrillic, Greek, CJK and emoji: Devanagari, Bengali, Tamil,
 *  Telugu, Kannada, Malayalam, Gurmukhi, Gujarati, Arabic, Persian, Pashto, Urdu,
 *  Thai, Burmese and Amharic have no glyphs at all, so a reader in one of those
 *  languages got a row of boxes where the menu should be. Correct words, drawn as
 *  nothing, which is the one way of being wrong that text mode cannot afford.
 *
 *  So the panel falls back to English where the font cannot draw the reader's own
 *  language. The phone's own panes are not touched by this: a reader reads their
 *  language on the glass where the glass can draw it and on the phone always - see
 *  `t` in i18n.svelte.ts, which is what every pane still calls.
 *
 *  **Decided by what the font can draw, not by a list of scripts.** `undrawable` in
 *  packages/glasses/src/firmware.ts answers what share of a text the font has no
 *  glyph for, and that is asked of the reader's own catalogue. Measured over the
 *  thirty-nine, the answer is two groups and nothing in between: every Latin,
 *  Cyrillic, Greek and CJK catalogue is at 0.0%, and the fifteen scripts above are
 *  at 31% and more. A catalogue in a script the firmware gains is drawable the day
 *  the metrics say so, and a hand list would still say no. */

import { undrawable } from '@nib/glasses'
import { i18n, t } from '../i18n.svelte'

/** How much of a catalogue may be undrawable before the panel gives up on it.
 *
 *  A tenth. The two groups are 0% and 31%, so this is nowhere near either: what it
 *  is for is a catalogue that borrows a word - a brand, a key name - rather than one
 *  written in a script the font has not got. */
const MOST_MISSING = 0.1

/** The words the question is asked of: the panel's own, in the reader's language.
 *
 *  Its own menu rather than a sample of the whole catalogue, because these are the
 *  strings that would be drawn as boxes, and because it is six lookups rather than a
 *  walk of a thousand rows on every launch. */
const SAMPLE = ['Settings', 'Switch space', 'Change note', 'Voice off', 'Spaces', 'Notes']

/** What was decided, and for which catalogue. A reader who changes language mid
 *  sitting is asked again; nobody else is. */
let decided: { language: string; drawable: boolean } | null = null

/** Whether the panel can be written in the reader's own language. */
export function panelDrawable(): boolean {
  const language = i18n.language
  if (decided?.language === language) return decided.drawable

  const said = SAMPLE.map((one) => t(one)).join(' ')
  const drawable = undrawable(said) <= MOST_MISSING
  decided = { language, drawable }
  return drawable
}

/** `{name}` filled in, the way `t` fills it. Here because the panel's English is the
 *  key itself, which has not been through the catalogue and so has not been filled. */
function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const found = values[name]
    return found === undefined ? whole : String(found)
  })
}

/** One string for the panel: the reader's language where the firmware can draw it,
 *  and English where it cannot.
 *
 *  English is the key itself. Every string in this app is filed under what it says in
 *  English, which is what makes the fallback a lookup nobody has to ship a second
 *  catalogue for; see i18n.svelte.ts. */
export function panelWord(text: string, values?: Record<string, string | number>): string {
  return panelDrawable() ? t(text, values) : fill(text, values)
}

/** Asked again the next time somebody wants a word. For the tests, which change
 *  language between one assertion and the next. */
export function forgetPanelLanguage(): void {
  decided = null
}
