import type { Message } from '../ai-providers/src/api'

export type Verb = 'shorter' | 'longer' | 'grammar' | 'translate'

export const VERBS: { id: Verb; label: string }[] = [
  { id: 'shorter', label: 'Shorter' },
  { id: 'longer', label: 'Longer' },
  { id: 'grammar', label: 'Fix grammar' },
  { id: 'translate', label: 'Translate' },
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

const LANGUAGES: readonly { id: string; name: string }[] = [
  { id: 'id', name: 'Bahasa Indonesia' },
  { id: 'ms', name: 'Bahasa Melayu' },
  { id: 'jv', name: 'Basa Jawa' },
  { id: 'de', name: 'Deutsch' },
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'fil', name: 'Filipino' },
  { id: 'fr', name: 'Français' },
  { id: 'ha', name: 'Hausa' },
  { id: 'it', name: 'Italiano' },
  { id: 'sw', name: 'Kiswahili' },
  { id: 'pl', name: 'Polski' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'pt-PT', name: 'Português (Portugal)' },
  { id: 'gsw', name: 'Schwiizerdütsch' },
  { id: 'vi', name: 'Tiếng Việt' },
  { id: 'tr', name: 'Türkçe' },
  { id: 'ru', name: 'Русский' },
  { id: 'uk', name: 'Українська' },
  { id: 'ur', name: 'اردو' },
  { id: 'ar', name: 'العربية' },
  { id: 'ps', name: 'پښتو' },
  { id: 'fa', name: 'فارسی' },
  { id: 'am', name: 'አማርኛ' },
  { id: 'mr', name: 'मराठी' },
  { id: 'hi', name: 'हिन्दी' },
  { id: 'bn', name: 'বাংলা' },
  { id: 'pa', name: 'ਪੰਜਾਬੀ' },
  { id: 'gu', name: 'ગુજરાતી' },
  { id: 'ta', name: 'தமிழ்' },
  { id: 'te', name: 'తెలుగు' },
  { id: 'kn', name: 'ಕನ್ನಡ' },
  { id: 'ml', name: 'മലയാളം' },
  { id: 'th', name: 'ไทย' },
  { id: 'my', name: 'မြန်မာ' },
  { id: 'ko', name: '한국어' },
  { id: 'ja', name: '日本語' },
  { id: 'zh-Hans', name: '简体中文' },
  { id: 'yue', name: '粵語' },
  { id: 'zh-Hant', name: '繁體中文' },
  { id: 'zh-Hant-HK', name: '繁體中文（香港）' },
]

export function languageNames(): { id: string; name: string }[] {
  return [...LANGUAGES]
}

export function defaultLanguage(region: string): string {
  const base = region.split('-')[0]
  const found =
    LANGUAGES.find((one) => one.id === region) ?? LANGUAGES.find((one) => one.id === base)
  return found?.id ?? 'en'
}

export function nameOfLanguage(id: string): string {
  return languageNames().find((one) => one.id === id)?.name ?? 'English'
}

export function stillThere(
  text: string,
  place: { from: number; to: number },
  before: string,
): { from: number; to: number } | null {
  if (text.slice(place.from, place.to) === before) return place
  let best: number | null = null
  for (let at = text.indexOf(before); at !== -1; at = text.indexOf(before, at + 1)) {
    if (best === null || Math.abs(at - place.from) < Math.abs(best - place.from)) best = at
  }
  return best === null ? null : { from: best, to: best + before.length }
}
