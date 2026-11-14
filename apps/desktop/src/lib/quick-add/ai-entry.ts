import { todayOf } from '@orden/bases'
import type { QuickFields } from '@orden/bases/language'
import { isDate } from '@orden/markdown/task-line'
import { complete } from '../ai/complete'
import type { Message, Provider } from '../ai/providers'
import type { Entry } from './entry'

const ASK =
  'Turn the reader’s sentence into one task. Reply with one JSON object and nothing else: {"text": the task in a few words, in the sentence’s language, "tags": the labels from the list given that fit, or [], "start": the first day it can be done on (YYYY-MM-DD) or null, "deadline": the day it must be done by (YYYY-MM-DD) or null, "priority": 1 urgent, 2 high, 3 medium or 4 none}.'

export function entryMessages(
  said: string,
  tags: readonly string[],
  today: string,
  zone: string,
): Message[] {
  const day = new Date(`${today}T12:00:00Z`).toLocaleDateString('en', {
    weekday: 'long',
    timeZone: 'UTC',
  })
  const context = `Today is ${day}, ${today}, in ${zone}.\nLabels: ${JSON.stringify(tags)}`
  return [
    { role: 'system', content: ASK },
    { role: 'user', content: `${context}\n\n${said}` },
  ]
}

export function entryFrom(reply: string, said: string, tags: readonly string[]): Entry {
  const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  const read = JSON.parse(json) as Record<string, unknown>
  const named = Array.isArray(read.tags)
    ? read.tags.map((one) => String(one).replace(/^#/, ''))
    : []
  const fields: QuickFields = { tags: tags.filter((one) => named.includes(one)), remind: [] }
  if (typeof read.start === 'string' && isDate(read.start)) fields.due = read.start
  if (typeof read.deadline === 'string' && isDate(read.deadline)) fields.deadline = read.deadline
  if (typeof read.priority === 'number' && [1, 2, 3, 4, 5, 6].includes(read.priority)) {
    fields.priority = read.priority as NonNullable<QuickFields['priority']>
  }
  const text = typeof read.text === 'string' && read.text.trim() ? read.text.trim() : said
  return { text, fields }
}

export async function askedEntry(
  provider: Provider,
  said: string,
  tags: readonly string[],
): Promise<Entry> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const messages = entryMessages(said, tags, todayOf(), zone)
  const reply = await complete({ provider, model: provider.model, messages })
  return entryFrom(reply, said, tags)
}
