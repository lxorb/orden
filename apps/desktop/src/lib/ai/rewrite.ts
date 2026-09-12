/** The four things a model is asked to do to a selection.
 *
 *  Four and not a text box: a menu of verbs is something you can use without
 *  thinking, and "write me a prompt" is the thing everybody says they want and
 *  nobody does twice. Shorter, longer, the grammar fixed, or the same words in
 *  another language - which between them are what anybody ever asks of a paragraph
 *  they have already written.
 *
 *  Pure: the verbs, and the words each one sends. What the selection is, what comes
 *  back and whether it is kept are RewriteSheet.svelte's. */

import { key, LANGUAGES } from '../i18n.svelte'
import type { Message } from './providers'

export type Verb = 'shorter' | 'longer' | 'grammar' | 'translate'

/** The verbs in the order the sheet offers them: the two that change the length
 *  first, because they are the two anybody reaches for. */
export const VERBS: { id: Verb; label: string }[] = [
  { id: 'shorter', label: key('Shorter') },
  { id: 'longer', label: key('Longer') },
  { id: 'grammar', label: key('Fix grammar') },
  { id: 'translate', label: key('Translate') },
]

/** What each verb tells the model. One sentence each, and the same three rules
 *  under all of them: the answer replaces the selection, so it may not carry a word
 *  of commentary, may not be fenced, and has to keep whatever markdown was in it.
 *
 *  `language` is the name of the language to translate into, and is only read by the
 *  verb that needs one. */
function instruction(verb: Verb, language: string): string {
  switch (verb) {
    case 'shorter':
      return 'Rewrite the text below so it says the same thing in fewer words.'
    case 'longer':
      return 'Rewrite the text below at greater length, saying more about the same thing.'
    case 'grammar':
      return 'Correct the spelling, grammar and punctuation of the text below. Change nothing else: not the wording, not the tone, not the order of anything.'
    case 'translate':
      return `Translate the text below into ${language}.`
  }
}

const RULES = [
  'Answer with the rewritten text and nothing else: no preamble, no explanation,',
  'no quotation marks around it and no code fence around it. Keep the markdown that',
  'is in it - headings, lists, emphasis, links - exactly as markdown.',
].join(' ')

/** The messages one rewrite is asked with. */
export function rewriteMessages(verb: Verb, language: string, selection: string): Message[] {
  return [
    { role: 'system', content: `${instruction(verb, language)} ${RULES}` },
    { role: 'user', content: selection },
  ]
}

/** What a language is called, for the verb that translates into one. The names in
 *  `LANGUAGES` are each written in the language itself, which is exactly what a
 *  model should be told; the two entries that are not languages are left out. */
export function languageNames(): { id: string; name: string }[] {
  return LANGUAGES.filter((one) => one.id !== 'system').map((one) => ({
    id: one.id,
    name: one.name,
  }))
}

/** The language a rewrite translates into unless another is picked: the one the app
 *  is set to. English where the app is following a system language nib has no
 *  dictionary for, since that is what the interface is showing anyway. */
export function defaultLanguage(appLanguage: string): string {
  const found = languageNames().find((one) => one.id === appLanguage)
  return found?.id ?? 'en'
}

/** The name behind an id, for the sentence the model is sent. */
export function nameOfLanguage(id: string): string {
  return languageNames().find((one) => one.id === id)?.name ?? 'English'
}
