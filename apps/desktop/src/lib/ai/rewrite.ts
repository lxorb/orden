import { key, LANGUAGES } from '../i18n.svelte'
import type { Message } from './providers'

export type Verb = 'shorter' | 'longer' | 'grammar' | 'translate'

export const VERBS: { id: Verb; label: string }[] = [
  { id: 'shorter', label: key('Shorter') },
  { id: 'longer', label: key('Longer') },
  { id: 'grammar', label: key('Fix grammar') },
  { id: 'translate', label: key('Translate') },
]

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

export function rewriteMessages(verb: Verb, language: string, selection: string): Message[] {
  return [
    { role: 'system', content: `${instruction(verb, language)} ${RULES}` },
    { role: 'user', content: selection },
  ]
}

export function languageNames(): { id: string; name: string }[] {
  return LANGUAGES.filter((one) => one.id !== 'system').map((one) => ({
    id: one.id,
    name: one.name,
  }))
}

export function defaultLanguage(appLanguage: string): string {
  const found = languageNames().find((one) => one.id === appLanguage)
  return found?.id ?? 'en'
}

export function nameOfLanguage(id: string): string {
  return languageNames().find((one) => one.id === id)?.name ?? 'English'
}
