import { plainWords } from './escapes'
import { taskAt } from './tasks'
import { codeAndWords, codeSpans, inCode, opensTag, opensTagAt, tagAt } from './tags'

export type Priority = 1 | 2 | 3 | 4 | 5 | 6

export const NO_PRIORITY: Priority = 4

export type Remind = { before: number } | { time: string } | { at: string; time: string }

export interface TaskFields {
  text: string
  status: string
  done: boolean
  cancelled: boolean
  due?: string
  scheduled?: string
  start?: string
  created?: string
  completed?: string
  cancelledOn?: string
  time?: string
  zone?: string
  duration?: number
  deadline?: string
  remind: Remind[]
  priority: Priority
  recurrence?: string
  onCompletion?: string
  tags: string[]
  assignee?: string
  id?: string
  dependsOn: string[]
  block?: string
  fields: Record<string, string>
}

export type FieldName =
  | 'due'
  | 'scheduled'
  | 'start'
  | 'created'
  | 'completed'
  | 'cancelledOn'
  | 'priority'
  | 'recurrence'
  | 'onCompletion'
  | 'id'
  | 'dependsOn'
  | 'time'
  | 'duration'
  | 'deadline'
  | 'remind'
  | 'assignee'
  | 'block'

export type FieldForm = 'emoji' | 'bracket' | 'paren' | 'tag' | 'caret'

export interface FieldToken {
  field: FieldName | 'tag' | 'other'
  form: FieldForm
  from: number
  to: number
  valueFrom: number
  valueTo: number
  key?: string
  inline: boolean
}

export interface ParsedTask {
  fields: TaskFields
  box: number
  wordsFrom: number
  wordsTo: number
  tokens: FieldToken[]
}

const PRIORITY_BY_EMOJI: ReadonlyMap<string, Priority> = new Map(
  Object.entries({
    '🔺': 1,
    '⏫': 2,
    '🔼': 3,
    '🔽': 5,
    '⏬': 6,
  } satisfies Record<string, Priority>),
)

export const EMOJI_BY_PRIORITY: Record<Priority, string> = {
  1: '🔺',
  2: '⏫',
  3: '🔼',
  4: '',
  5: '🔽',
  6: '⏬',
}

const PRIORITY_BY_WORD: ReadonlyMap<string, Priority> = new Map(
  Object.entries({
    highest: 1,
    high: 2,
    medium: 3,
    none: 4,
    normal: 4,
    low: 5,
    lowest: 6,
  } satisfies Record<string, Priority>),
)

export const WORD_BY_PRIORITY: Record<Priority, string> = {
  1: 'highest',
  2: 'high',
  3: 'medium',
  4: 'none',
  5: 'low',
  6: 'lowest',
}

const DATE_BY_EMOJI: ReadonlyMap<string, FieldName> = new Map(
  Object.entries({
    '✅': 'completed',
    '❌': 'cancelledOn',
    '📅': 'due',
    '📆': 'due',
    '🗓': 'due',
    '⏳': 'scheduled',
    '⌛': 'scheduled',
    '🛫': 'start',
    '➕': 'created',
  } satisfies Record<string, FieldName>),
)

export const EMOJI_BY_DATE: Partial<Record<FieldName, string>> = {
  completed: '✅',
  cancelledOn: '❌',
  due: '📅',
  scheduled: '⏳',
  start: '🛫',
  created: '➕',
}

export const RECURRENCE_EMOJI = '🔁'
export const ON_COMPLETION_EMOJI = '🏁'
export const ID_EMOJI = '🆔'
export const DEPENDS_EMOJI = '⛔'

const FIELD_BY_KEY: ReadonlyMap<string, FieldName> = new Map(
  Object.entries({
    due: 'due',
    scheduled: 'scheduled',
    start: 'start',
    created: 'created',
    completion: 'completed',
    cancelled: 'cancelledOn',
    priority: 'priority',
    repeat: 'recurrence',
    oncompletion: 'onCompletion',
    id: 'id',
    dependson: 'dependsOn',
    time: 'time',
    duration: 'duration',
    deadline: 'deadline',
    remind: 'remind',
    assignee: 'assignee',
  } satisfies Record<string, FieldName>),
)

export const KEY_BY_FIELD: Record<FieldName, string> = {
  due: 'due',
  scheduled: 'scheduled',
  start: 'start',
  created: 'created',
  completed: 'completion',
  cancelledOn: 'cancelled',
  priority: 'priority',
  recurrence: 'repeat',
  onCompletion: 'onCompletion',
  id: 'id',
  dependsOn: 'dependsOn',
  time: 'time',
  duration: 'duration',
  deadline: 'deadline',
  remind: 'remind',
  assignee: 'assignee',
  block: 'block',
}

export const ORDEN_FIELDS: readonly FieldName[] = [
  'time',
  'duration',
  'deadline',
  'remind',
  'assignee',
]

export const TASKS_FIELDS: readonly FieldName[] = [
  'id',
  'dependsOn',
  'priority',
  'recurrence',
  'onCompletion',
  'created',
  'start',
  'scheduled',
  'due',
  'cancelledOn',
  'completed',
]

const VARIANT = '️?'
const DATE = String.raw`(\d{4}-\d{2}-\d{2})`

const AT_END = {
  block: /(?<=\s)\^([A-Za-z0-9-]+)$/u,
  priority: new RegExp(`(🔺|⏫|🔼|🔽|⏬)${VARIANT}$`, 'u'),
  date: new RegExp(`(✅|❌|📅|📆|🗓|⏳|⌛|🛫|➕)${VARIANT} *${DATE}$`, 'u'),
  recurrence: new RegExp(`🔁${VARIANT} *([a-zA-Z0-9,!][a-zA-Z0-9, !]*)$`, 'u'),
  onCompletion: new RegExp(`🏁${VARIANT} *([a-zA-Z]+)$`, 'u'),
  tag: /(?<=^|\s)#[^ !@#$%^&*(),.?":{}|<>]+$/u,
  id: new RegExp(`🆔${VARIANT} *([a-zA-Z0-9-_]+)$`, 'u'),
  dependsOn: new RegExp(`⛔${VARIANT} *([a-zA-Z0-9-_]+(?: *, *[a-zA-Z0-9-_]+)*) *$`, 'u'),
}

const FIELD_KEY = { '[': /\[([^[\]():]+?)::/uy, '(': /\(([^[\]():]+?)::/uy }

interface Found {
  index: number
  0: string
  [group: number]: string | undefined
}

function fieldAt(text: string, at: number, last: number): Found | null {
  if (escaped(text, at)) return null
  const open = text[at] === '[' ? '[' : '('
  const key = FIELD_KEY[open]
  key.lastIndex = at
  const found = key.exec(text)
  if (!found || key.lastIndex > last) return null

  const end = text.indexOf(open === '[' ? ']' : ')', key.lastIndex)
  let from = key.lastIndex
  let to = end
  while (from < to && isBlank(text[from])) from++
  while (to > from && isBlank(text[to - 1])) to--

  return { index: at, 0: text.slice(at, end + 1), 1: found[1], 2: text.slice(from, to) }
}

function escaped(text: string, at: number): boolean {
  let before = at
  while (before > 0 && text[before - 1] === '\\') before--
  return (at - before) % 2 === 1
}

function isBlank(character: string | undefined): boolean {
  return character === ' ' || character === '\t'
}

function fieldAtEnd(head: string): Found | null {
  const shut = head.at(-1)
  if (shut !== ']' && shut !== ')') return null

  const end = head.length - 1
  const open = shut === ']' ? '[' : '('
  let at = head.indexOf(open, head.lastIndexOf(shut, end - 1) + 1)
  const code = codeSpans(head)
  for (; at !== -1 && at < end; at = head.indexOf(open, at + 1)) {
    if (inCode(code, at)) continue
    const found = fieldAt(head, at, end)
    if (found) return found
  }

  return null
}

const OPENS = /[[(]/g

const HASH = /#/g

const MOST_FIELDS = 40

function keyOf(written: string): string {
  return written
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

export function fieldOfKey(key: string): FieldName | undefined {
  return FIELD_BY_KEY.get(keyOf(key))
}

const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s+([A-Za-z_][\w+-]*(?:\/[\w+-]+)*))?$/

export function readTime(value: string): { time: string; zone?: string } | null {
  const found = TIME.exec(value.trim())
  if (!found) return null
  const hours = Number(found[1])
  const minutes = Number(found[2])
  if (hours > 23 || minutes > 59) return null
  const time = `${String(hours).padStart(2, '0')}:${found[2] ?? '00'}`
  return found[3] ? { time, zone: found[3] } : { time }
}

export function readDuration(value: string): number | null {
  const written = value.trim().toLowerCase()
  if (/^\d+$/.test(written)) return Number(written)

  const found =
    /^(?:(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|std)\.?)?\s*(?:(\d+)\s*(?:m|min|mins|minutes?)\.?)?$/u.exec(
      written,
    )
  if (!found || (found[1] === undefined && found[2] === undefined)) return null

  const hours = Number((found[1] ?? '0').replace(',', '.'))
  return Math.round(hours * 60) + Number(found[2] ?? '0')
}

export function writeDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`
}

function readBefore(value: string): number | null {
  const found = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec(value.trim().toLowerCase())
  if (!found || (found[1] === undefined && found[2] === undefined && found[3] === undefined)) {
    return null
  }
  return Number(found[1] ?? 0) * 1440 + Number(found[2] ?? 0) * 60 + Number(found[3] ?? 0)
}

function writeBefore(minutes: number): string {
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}d`
  return writeDuration(minutes)
}

export function readRemind(value: string): Remind[] | null {
  const out: Remind[] = []
  for (const part of value.split(',')) {
    const one = part.trim()
    if (one === '') continue
    const at = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/.exec(one)
    const time = readTime(one)
    const before = readBefore(one)
    if (at?.[1] && at[2]) {
      const read = readTime(at[2])
      if (!read) return null
      out.push({ at: at[1], time: read.time })
    } else if (time && !time.zone) {
      out.push({ time: time.time })
    } else if (before !== null) {
      out.push({ before })
    } else {
      return null
    }
  }
  return out
}

export function writeRemind(remind: readonly Remind[]): string {
  return remind
    .map((one) => {
      if ('before' in one) return writeBefore(one.before)
      if ('at' in one) return `${one.at} ${one.time}`
      return one.time
    })
    .join(', ')
}

export function isDate(value: string): boolean {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!found) return false
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function emptyFields(status: string): TaskFields {
  return {
    text: '',
    status,
    done: status === 'x' || status === 'X',
    cancelled: status === '-',
    remind: [],
    priority: NO_PRIORITY,
    tags: [],
    dependsOn: [],
    fields: Object.create(null) as Record<string, string>,
  }
}

function setField(fields: TaskFields, field: FieldName, value: string): boolean {
  switch (field) {
    case 'due':
    case 'scheduled':
    case 'start':
    case 'created':
    case 'completed':
    case 'cancelledOn':
    case 'deadline': {
      const date = value.trim().slice(0, 10)
      if (!isDate(date)) return false
      fields[field] = date
      return true
    }
    case 'priority': {
      const priority =
        PRIORITY_BY_EMOJI.get(value) ?? PRIORITY_BY_WORD.get(value.trim().toLowerCase())
      if (priority === undefined) return false
      fields.priority = priority
      return true
    }
    case 'recurrence':
    case 'onCompletion':
    case 'id':
    case 'assignee':
    case 'block': {
      const one = value.trim()
      if (one === '') return false
      fields[field] = one
      return true
    }
    case 'dependsOn':
      fields.dependsOn = value
        .split(',')
        .map((one) => one.trim())
        .filter((one) => one !== '')
      return true
    case 'time': {
      const read = readTime(value)
      if (!read) return false
      fields.time = read.time
      if (read.zone) fields.zone = read.zone
      return true
    }
    case 'duration': {
      const minutes = readDuration(value)
      if (minutes === null) return false
      fields.duration = minutes
      return true
    }
    case 'remind': {
      const remind = readRemind(value)
      if (!remind) return false
      fields.remind = remind
      return true
    }
  }
}

const DATE_FIELDS: ReadonlySet<FieldToken['field']> = new Set([
  'due',
  'scheduled',
  'start',
  'created',
  'completed',
  'cancelledOn',
  'deadline',
])

function heldLength(field: FieldToken['field'], value: string): number {
  return DATE_FIELDS.has(field) ? Math.min(10, value.length) : value.length
}

function trailingTokens(
  line: string,
  from: number,
  fields: TaskFields,
  seen: Set<FieldName>,
): { tokens: FieldToken[]; end: number } {
  const tokens: FieldToken[] = []
  let end = line.trimEnd().length

  const take = (
    found: Found,
    field: FieldToken['field'],
    form: FieldForm,
    value: number,
    key?: string,
  ) => {
    const start = from + found.index
    const valueText = found[value] ?? ''
    const valueFrom =
      valueText === '' && (form === 'bracket' || form === 'paren')
        ? start + found[0].length - 1
        : start + found[0].lastIndexOf(valueText)
    const token: FieldToken = {
      field,
      form,
      from: start,
      to: start + found[0].length,
      valueFrom,
      valueTo: valueFrom + heldLength(field, valueText),
      inline: false,
    }
    if (key !== undefined) token.key = key
    tokens.unshift(token)
    end = line.slice(0, start).trimEnd().length
  }

  const read = (field: FieldName, value: string) => {
    if (seen.has(field)) return true
    seen.add(field)
    return setField(fields, field, value)
  }

  const block = AT_END.block.exec(line.slice(from, end))
  if (block) {
    take(block, 'block', 'caret', 1)
    read('block', block[1] ?? '')
  }

  for (let runs = 0; runs < MOST_FIELDS && end > from; runs++) {
    const head = line.slice(from, end)
    let found: Found | null

    if ((found = AT_END.priority.exec(head))) {
      read('priority', found[1] ?? '')
      take(found, 'priority', 'emoji', 1)
    } else if ((found = AT_END.date.exec(head))) {
      const field = DATE_BY_EMOJI.get(found[1] ?? '') ?? 'due'
      read(field, found[2] ?? '')
      take(found, field, 'emoji', 2)
    } else if ((found = AT_END.recurrence.exec(head))) {
      read('recurrence', found[1] ?? '')
      take(found, 'recurrence', 'emoji', 1)
    } else if ((found = AT_END.onCompletion.exec(head))) {
      read('onCompletion', found[1] ?? '')
      take(found, 'onCompletion', 'emoji', 1)
    } else if ((found = AT_END.tag.exec(head)) && !inCode(codeSpans(head), found.index)) {
      take(found, 'tag', 'tag', 0)
    } else if ((found = AT_END.id.exec(head))) {
      read('id', found[1] ?? '')
      take(found, 'id', 'emoji', 1)
    } else if ((found = AT_END.dependsOn.exec(head))) {
      read('dependsOn', found[1] ?? '')
      take(found, 'dependsOn', 'emoji', 1)
    } else if ((found = fieldAtEnd(head))) {
      const form: FieldForm = found[0].startsWith('[') ? 'bracket' : 'paren'
      const key = found[1] ?? ''
      const field = FIELD_BY_KEY.get(keyOf(key))
      const known = field !== undefined && read(field, found[2] ?? '')
      if (!known) fields.fields[key.trim()] = (found[2] ?? '').trim()
      take(found, known ? field : 'other', form, 2, key)
    } else {
      break
    }
  }

  return { tokens, end: Math.max(end, from) }
}

function inlineTokens(
  line: string,
  from: number,
  to: number,
  fields: TaskFields,
  seen: Set<FieldName>,
): FieldToken[] {
  const tokens: FieldToken[] = []
  const words = line.slice(from, to)

  const last = { '[': words.lastIndexOf(']'), '(': words.lastIndexOf(')') }
  const code = codeSpans(words)

  for (OPENS.lastIndex = 0; OPENS.exec(words);) {
    const at = OPENS.lastIndex - 1
    const inside = code.find(([from, to]) => at >= from && at < to)
    if (inside) {
      OPENS.lastIndex = inside[1]
      continue
    }
    const found = fieldAt(words, at, words[at] === '[' ? last['['] : last['('])
    if (!found) continue
    OPENS.lastIndex = at + found[0].length

    const bracket = found[0].startsWith('[')
    const key = found[1] ?? ''
    const value = found[2] ?? ''
    const field = FIELD_BY_KEY.get(keyOf(key))
    const start = from + found.index
    const known = field !== undefined && !seen.has(field) && setField(fields, field, value)
    if (known) seen.add(field)
    else fields.fields[key.trim()] = value.trim()
    const valueFrom =
      value === '' ? start + found[0].length - 1 : start + found[0].lastIndexOf(value)
    const held = heldLength(known ? field : 'other', value)
    tokens.push({
      field: known ? field : 'other',
      form: bracket ? 'bracket' : 'paren',
      from: start,
      to: start + found[0].length,
      valueFrom,
      valueTo: value === '' ? valueFrom : valueFrom + held,
      key,
      inline: true,
    })
  }
  return tokens
}

export function tagsIn(text: string): string[] {
  const out: string[] = []
  const code = codeSpans(text)
  for (const found of text.matchAll(HASH)) {
    const name = inCode(code, found.index) ? null : tagAt(text, found.index)
    if (name !== null && !out.includes(name)) out.push(name)
  }
  return out
}

export function parseTask(line: string): ParsedTask | null {
  const item = taskAt(line)
  if (!item) return null

  const fields = emptyFields(item.mark)
  const seen = new Set<FieldName>()
  const { tokens: trailing, end } = trailingTokens(line, item.marker, fields, seen)
  const inline = inlineTokens(line, item.marker, end, fields, seen)

  let text = line.slice(item.marker, end)
  for (const token of [...inline].reverse()) {
    const before = text.slice(0, token.from - item.marker).trimEnd()
    const after = text.slice(token.to - item.marker).trimStart()
    text = before === '' || after === '' ? before + after : `${before} ${after}`
  }
  fields.text = text.trim()

  const trailingTags = trailing.filter((token) => token.field === 'tag')
  fields.tags = tagsIn(
    [
      line.slice(item.marker, end),
      ...trailingTags.map((token) => line.slice(token.from, token.to)),
    ].join(' '),
  )

  return {
    fields,
    box: item.box,
    wordsFrom: item.marker,
    wordsTo: end,
    tokens: [...inline, ...trailing],
  }
}

export function readTask(line: string): TaskFields | null {
  return parseTask(line)?.fields ?? null
}

const FIELD_EMOJI = /(🔺|⏫|🔼|🔽|⏬|✅|❌|📅|📆|🗓|⏳|⌛|🛫|➕|🔁|🏁|🆔|⛔)\uFE0F?/gu

export function taskWords(words: string): string {
  let before = ''
  return codeAndWords(words)
    .map((one) => {
      const written = one.code ? one.text : taskWordsAfter(one.text, before)
      before = one.text.at(-1) ?? before
      return written
    })
    .join('')
}

function taskWordsAfter(words: string, before: string): string {
  let out = ''
  for (let at = 0; at < words.length; at++) {
    const char = words.charAt(at)
    const prior = at > 0 ? words.charAt(at - 1) : before
    const opens = () => (at > 0 ? opensTagAt(words, at) : opensTag(before))
    if (char === '#' && prior !== '\\' && opens()) out += '\\#'
    else if (char === ':' && prior === ':' && endsKey(words, at - 1)) out += '\\:'
    else out += char
  }
  return out.replace(FIELD_EMOJI, '$&\u2060')
}

function endsKey(words: string, colon: number): boolean {
  for (let back = colon - 1; back >= 0; back--) {
    const char = words.charAt(back)
    if (char === '[' || char === '(') return back < colon - 1 && !escaped(words, back)
    if (char === ']' || char === ')' || char === ':') return false
  }
  return false
}

export function plainTaskWords(words: string): string {
  return taskWords(plainWords(words))
}
