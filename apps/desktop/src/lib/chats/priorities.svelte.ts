import {
  type Assigned,
  isLevel,
  type Lesson,
  type Level,
  levelIn,
  priorityAsk,
  type Said,
  type Suggestion,
  suggestionAsk,
  suggestionIn,
} from '@orden/chats/priority'
import { isNumber, isRecord, isString, keepJson, stored } from '../platform/src/api'

const KEY = 'orden:chat-priorities'
const MOST_LESSONS = 50
const OWN_ROW = 'orden\norden\n'

export type Asker = (messages: { role: 'system' | 'user'; content: string }[]) => Promise<string>

export interface Heard extends Said {
  at: number
}

interface Kept {
  on: boolean
  drafting: boolean
  assigned: Record<string, Assigned>
  lessons: Lesson[]
}

function chatOfKey(key: string): string | null {
  if (key.startsWith(OWN_ROW)) return key.slice(OWN_ROW.length)
  return key.includes('\n') ? null : key
}

function keptOf(value: unknown): Kept {
  const kept: Kept = { on: false, drafting: false, assigned: {}, lessons: [] }
  if (!isRecord(value)) return kept
  kept.on = value.on === true
  kept.drafting = value.drafting === true
  if (isRecord(value.assigned)) {
    for (const [key, one] of Object.entries(value.assigned)) {
      const chat = chatOfKey(key)
      if (chat && isRecord(one) && isLevel(one.level) && isNumber(one.at)) {
        kept.assigned[chat] = {
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
  assigned = $state.raw<Readonly<Record<string, Assigned>>>({})
  lessons = $state.raw<readonly Lesson[]>([])
  drafting = $state(false)
  suggestions = $state.raw<Readonly<Record<string, Suggestion & { at: number }>>>({})
  private ask: () => Asker | null = () => null

  constructor() {
    const kept = keptOf(stored(KEY))
    this.on = kept.on
    this.drafting = kept.drafting
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
    chat: string,
    title: string,
    newest: readonly Heard[],
    mine: readonly string[],
    today: string,
  ): Promise<Suggestion | null> {
    const last = newest.at(-1)
    const asker = this.ask()
    if (!this.drafting || !asker || !last || last.mine) return null
    if ((this.suggestions[chat]?.at ?? -1) >= last.at) return this.suggestions[chat] ?? null
    const found = suggestionIn(await asker(suggestionAsk(title, newest, mine, today)))
    if (!found) return null
    this.suggestions = { ...this.suggestions, [chat]: { ...found, at: last.at } }
    return found
  }

  settle(chat: string, part: 'reply' | 'todo' | 'all'): void {
    const held = this.suggestions[chat]
    if (!held) return
    const next = {
      ...held,
      ...(part === 'reply' ? { reply: null } : {}),
      ...(part === 'todo' ? { todo: null } : {}),
    }
    const rest = Object.fromEntries(
      Object.entries(this.suggestions).filter(([one]) => one !== chat),
    )
    this.suggestions =
      part === 'all' || (!next.reply && !next.todo) ? rest : { ...rest, [chat]: next }
  }

  levelOf(chat: string): Level | null {
    return this.assigned[chat]?.level ?? null
  }

  private assign(chat: string, one: Assigned): void {
    this.assigned = { ...this.assigned, [chat]: one }
    this.keep()
  }

  reassign(
    chat: string,
    level: Level,
    about: { title: string; from: string; words: string },
  ): void {
    this.assign(chat, { level, by: 'reader', at: this.assigned[chat]?.at ?? Date.now() })
    this.lessons = [...this.lessons, { ...about, level }].slice(-MOST_LESSONS)
    this.keep()
  }

  async heard(chat: string, title: string, newest: readonly Heard[]): Promise<Level | null> {
    const last = newest.at(-1)
    const asker = this.ask()
    if (!this.on || !asker || !last || last.mine) return null
    const held = this.assigned[chat]
    if (held && held.at >= last.at) return held.level
    const level = levelIn(await asker(priorityAsk(title, newest, this.lessons)))
    if (!level) return null
    this.assign(chat, { level, by: 'ai', at: last.at })
    return level
  }
}

export const priorities = new Priorities()
