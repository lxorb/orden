import {
  type Assigned,
  isLevel,
  LEVELS,
  type Lesson,
  type Level,
  levelIn,
  NOTIFY_DEFAULT,
  priorityAsk,
  type Said,
  type Suggestion,
  suggestionAsk,
  suggestionIn,
} from '@orden/chats/priority'
import type { ProviderMessage } from '@orden/chats/provider'
import { isNumber, isRecord, isString, keepJson, stored } from '../stored'

const KEY = 'nib:chat-priorities'
const MOST_LESSONS = 50

export type Asker = (messages: { role: 'system' | 'user'; content: string }[]) => Promise<string>

export function rowKey(provider: string, account: string, conversation: string): string {
  return `${provider}\n${account}\n${conversation}`
}

interface Kept {
  on: boolean
  drafting: boolean
  notify: Level[]
  assigned: Record<string, Assigned>
  lessons: Lesson[]
}

function keptOf(value: unknown): Kept {
  const kept: Kept = {
    on: false,
    drafting: false,
    notify: [...NOTIFY_DEFAULT],
    assigned: {},
    lessons: [],
  }
  if (!isRecord(value)) return kept
  kept.on = value.on === true
  kept.drafting = value.drafting === true
  if (Array.isArray(value.notify)) kept.notify = value.notify.filter(isLevel)
  if (isRecord(value.assigned)) {
    for (const [key, one] of Object.entries(value.assigned)) {
      if (isRecord(one) && isLevel(one.level) && isNumber(one.at)) {
        kept.assigned[key] = {
          level: one.level,
          by: one.by === 'reader' ? 'reader' : 'ai',
          at: one.at,
        }
      }
    }
  }
  if (Array.isArray(value.lessons)) {
    kept.lessons = value.lessons.flatMap((one: unknown) =>
      isRecord(one) &&
      isString(one.title) &&
      isString(one.from) &&
      isString(one.words) &&
      isLevel(one.level)
        ? [{ title: one.title, from: one.from, words: one.words, level: one.level }]
        : [],
    )
  }
  return kept
}

export class Priorities {
  on = $state(false)
  notify = $state.raw<readonly Level[]>(NOTIFY_DEFAULT)
  assigned = $state.raw<Readonly<Record<string, Assigned>>>({})
  lessons = $state.raw<readonly Lesson[]>([])
  drafting = $state(false)
  suggestions = $state.raw<Readonly<Record<string, Suggestion & { at: number }>>>({})
  private ask: () => Asker | null = () => null

  constructor() {
    const kept = keptOf(stored(KEY))
    this.on = kept.on
    this.drafting = kept.drafting
    this.notify = kept.notify
    this.assigned = kept.assigned
    this.lessons = kept.lessons
  }

  useAsker(ask: () => Asker | null): void {
    this.ask = ask
  }

  private keep(): void {
    keepJson(KEY, {
      on: this.on,
      drafting: this.drafting,
      notify: [...this.notify],
      assigned: { ...this.assigned },
      lessons: [...this.lessons],
    } satisfies Kept)
  }

  setOn(on: boolean): void {
    this.on = on
    this.keep()
  }

  setDrafting(on: boolean): void {
    this.drafting = on
    if (!on) this.suggestions = {}
    this.keep()
  }

  async suggest(
    key: string,
    title: string,
    newest: readonly ProviderMessage[],
    mine: readonly string[],
    today: string,
  ): Promise<Suggestion | null> {
    const last = newest.at(-1)
    const asker = this.ask()
    if (!this.drafting || !asker || !last || last.mine) return null
    if ((this.suggestions[key]?.at ?? -1) >= last.at) return this.suggestions[key] ?? null
    const said: Said[] = newest.map((one) => ({
      from: one.author.name,
      words: one.subject && !one.text ? one.subject : one.text,
      mine: one.mine,
    }))
    const found = suggestionIn(await asker(suggestionAsk(title, said, mine, today)))
    if (!found) return null
    this.suggestions = { ...this.suggestions, [key]: { ...found, at: last.at } }
    return found
  }

  settle(key: string, part: 'reply' | 'todo' | 'all'): void {
    const held = this.suggestions[key]
    if (!held) return
    const next = {
      ...held,
      ...(part === 'reply' ? { reply: null } : {}),
      ...(part === 'todo' ? { todo: null } : {}),
    }
    const rest = Object.fromEntries(Object.entries(this.suggestions).filter(([one]) => one !== key))
    this.suggestions =
      part === 'all' || (!next.reply && !next.todo) ? rest : { ...rest, [key]: next }
  }

  setNotify(levels: readonly Level[]): void {
    this.notify = LEVELS.filter((level) => levels.includes(level))
    this.keep()
  }

  levelOf(key: string): Level | null {
    return this.assigned[key]?.level ?? null
  }

  private assign(key: string, one: Assigned): void {
    this.assigned = { ...this.assigned, [key]: one }
    this.keep()
  }

  reassign(key: string, level: Level, about: { title: string; from: string; words: string }): void {
    this.assign(key, { level, by: 'reader', at: this.assigned[key]?.at ?? Date.now() })
    this.lessons = [...this.lessons, { ...about, level }].slice(-MOST_LESSONS)
    this.keep()
  }

  async heard(
    key: string,
    title: string,
    newest: readonly ProviderMessage[],
  ): Promise<Level | null> {
    const last = newest.at(-1)
    const asker = this.ask()
    if (!this.on || !asker || !last || last.mine) return null
    const held = this.assigned[key]
    if (held && held.at >= last.at) return held.level
    const said: Said[] = newest.map((one) => ({
      from: one.author.name,
      words: one.subject && !one.text ? one.subject : one.text,
      mine: one.mine,
    }))
    const level = levelIn(await asker(priorityAsk(title, said, this.lessons)))
    if (!level) return null
    this.assign(key, { level, by: 'ai', at: last.at })
    return level
  }
}

export const priorities = new Priorities()
