/** Quick add's Add with AI (#328): a sentence about something to do, read by a model as
 *  the task quick add writes. The model is told the day, the space's labels and notes,
 *  and answers in JSON, of which only what checks out is kept: a label the space has, a
 *  note it has, a real date, a priority there is. */

import type { QuickFields } from '@nib/bases/language'
import { isDate } from '@nib/markdown/task-line'
import type { Message } from '../ai/providers'
import { isPriority } from '../views/drop'
import type { Entry } from './entry'

/** The notes offered, the most recent first: every note of a space is too many. */
const NOTES = 100

/** How the model is asked. Sent to the model, never shown, so not translated. */
const ASK =
  'Turn the reader’s sentence into one task. Reply with one JSON object and nothing else: {"text": the task in a few words, in the sentence’s language, "tags": the labels from the list given that fit, or [], "start": the first day it can be done on (YYYY-MM-DD) or null, "deadline": the day it must be done by (YYYY-MM-DD) or null, "priority": 1 urgent, 2 high, 3 medium or 4 none, "note": the note from the list given it belongs in, or null}.'

/** The question: the day it is, the labels and notes there are, and the sentence. */
export function entryMessages(
  said: string,
  tags: readonly string[],
  notes: readonly string[],
  today: string,
  zone: string,
): Message[] {
  const day = new Date(`${today}T12:00:00Z`).toLocaleDateString('en', {
    weekday: 'long',
    timeZone: 'UTC',
  })
  const context = `Today is ${day}, ${today}, in ${zone}.\nLabels: ${JSON.stringify(tags)}\nNotes: ${JSON.stringify(notes.slice(0, NOTES))}`
  return [
    { role: 'system', content: ASK },
    { role: 'user', content: `${context}\n\n${said}` },
  ]
}

/** The reply as a task. Throws where it holds no JSON object. */
export function entryFrom(
  reply: string,
  said: string,
  tags: readonly string[],
  notes: readonly string[],
): Entry {
  const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  const read = JSON.parse(json) as Record<string, unknown>
  const named = Array.isArray(read.tags)
    ? read.tags.map((one) => String(one).replace(/^#/, ''))
    : []
  const fields: QuickFields = { tags: tags.filter((one) => named.includes(one)), remind: [] }
  if (typeof read.start === 'string' && isDate(read.start)) fields.due = read.start
  if (typeof read.deadline === 'string' && isDate(read.deadline)) fields.deadline = read.deadline
  if (typeof read.priority === 'number' && isPriority(read.priority))
    fields.priority = read.priority
  const text = typeof read.text === 'string' && read.text.trim() ? read.text.trim() : said
  const note = notes.find((one) => one === read.note)
  return { text, fields, ...(note === undefined ? {} : { note }) }
}
