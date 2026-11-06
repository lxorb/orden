import { englishLabel, LABEL_KEYS, setLabels } from '@orden/editor'
import { setChartLocale } from '@orden/markdown/chart'
import { type Direction, directionOf, factorOf, isolated } from './direction'
import { keep, storedText } from './stored'

export type Forms = Partial<Record<Intl.LDMLPluralRule, string>>
export type Dictionary = Record<string, string | Forms>

export interface Plural extends Forms {
  other: string
}

export interface Language {
  id: string
  name: string
  machine?: true
}

export const CATALOGUES_URL = 'https://github.com/lxorb/orden/tree/main/apps/desktop/src/locales'

export const LANGUAGES: readonly Language[] = [
  { id: 'system', name: 'Match the system' },
  { id: 'id', name: 'Bahasa Indonesia', machine: true },
  { id: 'ms', name: 'Bahasa Melayu', machine: true },
  { id: 'jv', name: 'Basa Jawa', machine: true },
  { id: 'de', name: 'Deutsch' },
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español', machine: true },
  { id: 'fil', name: 'Filipino', machine: true },
  { id: 'fr', name: 'Français' },
  { id: 'ha', name: 'Hausa', machine: true },
  { id: 'it', name: 'Italiano', machine: true },
  { id: 'sw', name: 'Kiswahili', machine: true },
  { id: 'pl', name: 'Polski', machine: true },
  { id: 'pt-BR', name: 'Português (Brasil)', machine: true },
  { id: 'pt-PT', name: 'Português (Portugal)', machine: true },
  { id: 'gsw', name: 'Schwiizerdütsch' },
  { id: 'vi', name: 'Tiếng Việt', machine: true },
  { id: 'tr', name: 'Türkçe', machine: true },
  { id: 'ru', name: 'Русский', machine: true },
  { id: 'uk', name: 'Українська', machine: true },
  { id: 'ur', name: 'اردو', machine: true },
  { id: 'ar', name: 'العربية', machine: true },
  { id: 'ps', name: 'پښتو', machine: true },
  { id: 'fa', name: 'فارسی', machine: true },
  { id: 'am', name: 'አማርኛ', machine: true },
  { id: 'mr', name: 'मराठी', machine: true },
  { id: 'hi', name: 'हिन्दी', machine: true },
  { id: 'bn', name: 'বাংলা', machine: true },
  { id: 'pa', name: 'ਪੰਜਾਬੀ', machine: true },
  { id: 'gu', name: 'ગુજરાતી', machine: true },
  { id: 'ta', name: 'தமிழ்', machine: true },
  { id: 'te', name: 'తెలుగు', machine: true },
  { id: 'kn', name: 'ಕನ್ನಡ', machine: true },
  { id: 'ml', name: 'മലയാളം', machine: true },
  { id: 'th', name: 'ไทย', machine: true },
  { id: 'my', name: 'မြန်မာ', machine: true },
  { id: 'ko', name: '한국어', machine: true },
  { id: 'ja', name: '日本語' },
  { id: 'zh-Hans', name: '简体中文', machine: true },
  { id: 'yue', name: '粵語', machine: true },
  { id: 'zh-Hant', name: '繁體中文', machine: true },
  { id: 'zh-Hant-HK', name: '繁體中文（香港）', machine: true },
]

const CATALOGUES: Record<string, () => Promise<Dictionary>> = {
  am: () => import('../locales/am').then((module) => module.am),
  ar: () => import('../locales/ar').then((module) => module.ar),
  bn: () => import('../locales/bn').then((module) => module.bn),
  de: () => import('../locales/de').then((module) => module.de),
  es: () => import('../locales/es').then((module) => module.es),
  fa: () => import('../locales/fa').then((module) => module.fa),
  fil: () => import('../locales/fil').then((module) => module.fil),
  fr: () => import('../locales/fr').then((module) => module.fr),
  gsw: () => import('../locales/gsw').then((module) => module.gsw),
  gu: () => import('../locales/gu').then((module) => module.gu),
  ha: () => import('../locales/ha').then((module) => module.ha),
  hi: () => import('../locales/hi').then((module) => module.hi),
  id: () => import('../locales/id').then((module) => module.id),
  it: () => import('../locales/it').then((module) => module.it),
  ja: () => import('../locales/ja').then((module) => module.ja),
  jv: () => import('../locales/jv').then((module) => module.jv),
  kn: () => import('../locales/kn').then((module) => module.kn),
  ko: () => import('../locales/ko').then((module) => module.ko),
  ml: () => import('../locales/ml').then((module) => module.ml),
  mr: () => import('../locales/mr').then((module) => module.mr),
  ms: () => import('../locales/ms').then((module) => module.ms),
  my: () => import('../locales/my').then((module) => module.my),
  pa: () => import('../locales/pa').then((module) => module.pa),
  pl: () => import('../locales/pl').then((module) => module.pl),
  ps: () => import('../locales/ps').then((module) => module.ps),
  'pt-BR': () => import('../locales/pt-BR').then((module) => module.ptBR),
  'pt-PT': () => import('../locales/pt-PT').then((module) => module.ptPT),
  ru: () => import('../locales/ru').then((module) => module.ru),
  sw: () => import('../locales/sw').then((module) => module.sw),
  ta: () => import('../locales/ta').then((module) => module.ta),
  te: () => import('../locales/te').then((module) => module.te),
  th: () => import('../locales/th').then((module) => module.th),
  tr: () => import('../locales/tr').then((module) => module.tr),
  uk: () => import('../locales/uk').then((module) => module.uk),
  ur: () => import('../locales/ur').then((module) => module.ur),
  vi: () => import('../locales/vi').then((module) => module.vi),
  yue: () => import('../locales/yue').then((module) => module.yue),
  'zh-Hans': () => import('../locales/zh-Hans').then((module) => module.zhHans),
  'zh-Hant': () => import('../locales/zh-Hant').then((module) => module.zhHant),
  'zh-Hant-HK': () => import('../locales/zh-Hant-HK').then((module) => module.zhHantHK),
}

export const CATALOGUE_IDS = Object.keys(CATALOGUES)

const ALSO: Record<string, string> = {
  in: 'id',
  pes: 'fa',
  prs: 'fa',
  pt: 'pt-BR',
  tl: 'fil',
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-HK': 'zh-Hant-HK',
  'zh-MO': 'zh-Hant',
  'zh-MY': 'zh-Hans',
  'zh-SG': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-YUE': 'yue',
}

function tidy(tag: string): string {
  return tag
    .replace(/_/g, '-')
    .split('-')
    .map((part, at) => {
      if (at === 0) return part.toLowerCase()
      if (part.length === 4) return part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase()
      return part.toUpperCase()
    })
    .join('-')
}

function known(tag: string): string | null {
  let parts = tidy(tag).split('-')
  if (parts[0] === 'en') return 'en'

  while (parts.length) {
    const candidate = parts.join('-')
    if (candidate in CATALOGUES) return candidate

    const named = ALSO[candidate]
    if (named) return named

    if (parts[0] === 'pt') return 'pt-PT'

    parts = parts.slice(0, -1)
  }

  return null
}

export function catalogueFor(tag: string): string {
  return known(tag) ?? 'en'
}

export function preferredCatalogue(asked: readonly string[]): string {
  for (const tag of asked) {
    const found = known(tag)
    if (found) return found
  }

  return 'en'
}

function systemCatalogue(): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const asked = navigator.languages?.length ? navigator.languages : [navigator.language || 'en']
  return preferredCatalogue(asked)
}

const STORAGE_KEY = 'nib:language'

/* eslint-disable svelte/prefer-svelte-reactivity */
const dates = new Map<string, Intl.DateTimeFormat>()
const numbers = new Map<string, Intl.NumberFormat>()
/* eslint-enable svelte/prefer-svelte-reactivity */

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const at = `${locale} ${JSON.stringify(options)}`
  const kept = dates.get(at)
  if (kept) return kept

  const made = new Intl.DateTimeFormat(locale, options)
  dates.set(at, made)
  return made
}

function numberFormat(locale: string): Intl.NumberFormat {
  const kept = numbers.get(locale)
  if (kept) return kept

  const made = new Intl.NumberFormat(locale)
  numbers.set(locale, made)
  return made
}

function pick(count: number, locale: string, forms: Forms): string {
  return forms[new Intl.PluralRules(locale).select(count)] ?? forms.other ?? ''
}

function fill(
  text: string,
  values: Record<string, string | number> | undefined,
  direction: Direction,
): string {
  if (!values) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? isolated(String(values[name]), direction) : whole,
  )
}

class I18n {
  choice = $state('system')

  private catalogue = $state<Dictionary>({})

  readonly language = $derived(this.choice === 'system' ? systemCatalogue() : this.choice)

  readonly direction = $derived(directionOf(this.language))

  readonly factor = $derived(factorOf(this.direction))

  readonly machine = $derived(
    LANGUAGES.some((one) => one.id === this.language && one.machine === true),
  )

  restore() {
    this.choice = storedText(STORAGE_KEY) ?? 'system'
    void this.load()
  }

  select(id: string) {
    this.choice = id
    keep(STORAGE_KEY, id)
    void this.load()
  }

  async load(): Promise<void> {
    const wanted = this.language
    if (typeof document !== 'undefined') {
      document.documentElement.lang = wanted
      document.documentElement.dir = directionOf(wanted)
    }
    setChartLocale(wanted)

    const fetching = CATALOGUES[wanted]
    const next = fetching ? await fetching().catch(() => ({})) : {}
    if (this.language !== wanted) return

    this.catalogue = next
    this.translateEditor()
  }

  private translateEditor() {
    setLabels(Object.fromEntries(LABEL_KEYS.map((key) => [key, this.t(englishLabel(key))])))
  }

  t(text: string, values?: Record<string, string | number>): string {
    const found = this.catalogue[text]
    return fill(typeof found === 'string' ? found : text, values, this.direction)
  }

  plural(count: number, forms: Plural, values?: Record<string, string | number>): string {
    const found = this.catalogue[forms.other]
    const translated =
      typeof found === 'string'
        ? found
        : found
          ? pick(count, this.language, found)
          : pick(count, 'en', forms)

    return fill(translated || forms.other, { count, ...values }, this.direction)
  }

  when(at: Date | number, options: Intl.DateTimeFormatOptions): string {
    return dateFormat(this.language, options).format(at)
  }

  amount(value: number): string {
    return numberFormat(this.language).format(value)
  }
}

export const i18n = new I18n()

export function message(error: unknown, fallback: string): string {
  const text = error instanceof Error && !(error instanceof TypeError) ? error.message : ''
  return t(text || fallback)
}

export const key = (text: string) => text

export const t = (text: string, values?: Record<string, string | number>) => i18n.t(text, values)

export const plural = (
  count: number,
  forms: Plural,
  values?: Record<string, string | number>,
): string => i18n.plural(count, forms, values)

export const amount = (value: number): string => i18n.amount(value)
