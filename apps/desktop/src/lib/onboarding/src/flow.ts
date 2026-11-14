import type { NotesFrom } from '@orden/contracts'

export const STEPS = [
  'account',
  'appearance',
  'heard',
  'browser',
  'import',
  'notes',
  'code',
  'ai',
  'welcome',
] as const

export type Step = (typeof STEPS)[number]

export type Coding = 'yes' | 'no' | null

export type MarkdownStyle = 'clean' | 'live'

export interface Answers {
  browser: string | null
  notes: string | null
  code: Coding
}

export interface Reach {
  signedIn: boolean
  importable: (browser: string) => boolean
  signIns: boolean
  phone: boolean
  heard: boolean
  connected: boolean
}

export function offersApiKey(code: Coding): boolean {
  return code !== 'no'
}

export function shows(step: Step, answers: Answers, reach: Reach): boolean {
  switch (step) {
    case 'account':
      return !reach.signedIn
    case 'heard':
      return !(reach.phone && reach.heard)
    case 'browser':
    case 'code':
      return !reach.phone
    case 'import':
      return !reach.phone && answers.browser !== null && reach.importable(answers.browser)
    case 'ai':
      if (reach.phone && reach.connected) return false
      return reach.signIns || offersApiKey(answers.code)
    case 'appearance':
    case 'notes':
    case 'welcome':
      return true
  }
}

export function firstStep(answers: Answers, reach: Reach): Step {
  return STEPS.find((step) => shows(step, answers, reach)) ?? 'welcome'
}

export function stepAfter(step: Step, answers: Answers, reach: Reach): Step {
  const later = STEPS.slice(STEPS.indexOf(step) + 1)
  return later.find((one) => shows(one, answers, reach)) ?? 'welcome'
}

export function isStep(value: unknown): value is Step {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value)
}

const STYLES: Readonly<Record<string, MarkdownStyle>> = {
  notion: 'clean',
  apple: 'clean',
  evernote: 'clean',
  keep: 'clean',
  roam: 'clean',
  obsidian: 'live',
  markdown: 'live',
  bear: 'live',
  logseq: 'live',
}

export function markdownStyleFor(app: string | null): MarkdownStyle | null {
  return app === null ? null : (STYLES[app] ?? null)
}

const ON_A_PHONE: ReadonlySet<string> = new Set(['notion', 'markdown'])

export function phoneBringing(app: string, bring: NotesFrom | null): NotesFrom | 'computer' | null {
  if (bring === null) return null
  return ON_A_PHONE.has(app) ? 'files' : 'computer'
}

export type KeyedKind = 'anthropic' | 'openai' | 'gemini'

export function keyKindOf(typed: string): KeyedKind | null {
  const key = typed.trim()
  if (key.length < 20 || /\s/.test(key)) return null
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('AIza')) return 'gemini'
  if (key.startsWith('sk-')) return 'openai'
  return null
}

export function matching<T extends { name: string }>(list: readonly T[], query: string): T[] {
  const wanted = query.trim().toLocaleLowerCase()
  if (!wanted) return [...list]
  return list.filter((one) => one.name.toLocaleLowerCase().includes(wanted))
}

export function typedName(query: string): string {
  return query
    .trim()
    .replace(
      /(^|\s)(\p{Ll})/gu,
      (_whole, space: string, letter: string) => `${space}${letter.toLocaleUpperCase()}`,
    )
}

export function requestKey(kind: 'browser' | 'notes' | 'ai', name: string): string {
  return `${kind}:${name.trim().toLocaleLowerCase()}`
}
