export type Level = 'urgent' | 'important' | 'if-time' | 'unimportant'

export const LEVELS: readonly Level[] = ['urgent', 'important', 'if-time', 'unimportant']

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

export interface Assigned {
  level: Level
  by: 'ai' | 'reader'
  at: number
}

export interface Lesson {
  title: string
  from: string
  words: string
  level: Level
}

export interface Said {
  from: string
  words: string
  mine: boolean
}

const MEANING: Record<Level, string> = {
  urgent: 'needs a reaction as fast as possible, e.g. the house is burning',
  important: 'should definitely be answered, but not immediately',
  'if-time': 'unsure, but has some importance, e.g. information to read tomorrow',
  unimportant: 'can be ignored, e.g. a reel, a newsletter, an advert',
}

const MOST_WORDS = 600

function clip(text: string, most: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > most ? `${flat.slice(0, most)}…` : flat
}

export function priorityAsk(
  title: string,
  said: readonly Said[],
  lessons: readonly Lesson[],
): { role: 'system' | 'user'; content: string }[] {
  const levels = LEVELS.map((level) => `- ${level}: ${MEANING[level]}`).join('\n')
  const taught = lessons
    .slice(-12)
    .map(
      (one) =>
        `- "${clip(one.title, 80)}" from ${clip(one.from, 60)}: "${clip(one.words, 160)}" -> ${one.level}`,
    )
    .join('\n')
  const lines = said
    .slice(-8)
    .map((one) => `${one.mine ? 'Me' : clip(one.from, 60)}: ${clip(one.words, MOST_WORDS)}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `You sort the reader's conversations by how soon they need the reader. Answer with exactly one of these words and nothing else:\n${levels}${taught ? `\n\nThe reader corrected these before; follow their judgement:\n${taught}` : ''}`,
    },
    { role: 'user', content: `Conversation: ${clip(title, 120)}\n\n${lines}` },
  ]
}

export function levelIn(reply: string): Level | null {
  const said = reply.toLowerCase().replace(/[^a-z-]+/g, ' ')
  const found = LEVELS.map((level) => ({ level, at: said.search(new RegExp(`\\b${level}\\b`)) }))
    .filter((one) => one.at >= 0)
    .sort((a, b) => a.at - b.at)[0]
  return found?.level ?? (said.includes('if time') ? 'if-time' : null)
}

export interface Waiting {
  level: Level | null
  since: number | null
}

export function byPriority(a: Waiting, b: Waiting): number {
  const rank = (one: Waiting) => (one.level ? LEVELS.indexOf(one.level) : LEVELS.length)
  return rank(a) - rank(b) || (a.since ?? Infinity) - (b.since ?? Infinity)
}

export const NOTIFY_DEFAULT: readonly Level[] = ['urgent', 'important']
export const VIBRATE: readonly Level[] = ['urgent']

export interface Suggestion {
  reply: string | null
  todo: { title: string; priority?: number; tags?: string[]; due?: string } | null
}

export function suggestionAsk(
  title: string,
  said: readonly Said[],
  mine: readonly string[],
  today: string,
): { role: 'system' | 'user'; content: string }[] {
  const samples = mine
    .slice(-15)
    .map((one) => `- ${clip(one, 300)}`)
    .join('\n')
  const lines = said
    .slice(-10)
    .map((one) => `${one.mine ? 'Me' : clip(one.from, 60)}: ${clip(one.words, MOST_WORDS)}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `You draft the reader's answer to a conversation, written exactly as the reader writes: the same language, length, greeting, spelling, punctuation, capitalisation and emoji as their own messages. Also suggest one task if the conversation asks the reader to do something. Answer with JSON only: {"reply": string or null, "todo": null or {"title": string, "priority": 1 to 4 or omitted, "tags": [string] or omitted, "due": "YYYY-MM-DD" or omitted}}. Today is ${today}.${samples ? `\n\nThe reader's own messages:\n${samples}` : ''}`,
    },
    { role: 'user', content: `Conversation: ${clip(title, 120)}\n\n${lines}` },
  ]
}

export function suggestionIn(reply: string): Suggestion | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let read: unknown
  try {
    read = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof read !== 'object' || read === null) return null
  const { reply: words, todo } = read as { reply?: unknown; todo?: unknown }
  const text = typeof words === 'string' && words.trim() ? words.trim() : null
  let task: Suggestion['todo'] = null
  if (typeof todo === 'object' && todo !== null) {
    const one = todo as { title?: unknown; priority?: unknown; tags?: unknown; due?: unknown }
    if (typeof one.title === 'string' && one.title.trim()) {
      task = { title: one.title.trim() }
      if (typeof one.priority === 'number' && one.priority >= 1 && one.priority <= 4) {
        task.priority = Math.round(one.priority)
      }
      if (Array.isArray(one.tags)) {
        const tags = one.tags.filter(
          (tag): tag is string => typeof tag === 'string' && /^[\p{L}\p{N}_/-]+$/u.test(tag),
        )
        if (tags.length) task.tags = tags
      }
      if (typeof one.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(one.due)) task.due = one.due
    }
  }
  return text || task ? { reply: text, todo: task } : null
}
