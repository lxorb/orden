import { Hono } from 'hono'
import { NOT_AN_OBJECT } from './refused'
import { objectBody, objectIn } from './body'
import { byteLength } from './crypto'
import { EFFORTS } from './ask/asking'
import { keyState } from './ask/key'
import type { Env, Variables } from './types'
import { KEEP_DAYS } from './versions'
import { REMIND_BEFORE } from './push/reminders'
import { isHours, isKeywords, LONGEST_KEYWORD, MOST_KEYWORDS } from '@orden/chats/notify'
import { lookWrong } from '@orden/sync-core/look'
import { askHub } from './hub/reach'

type Check = (value: unknown) => string | null

const ATTACHMENT_FOLDERS = ['space', 'note', 'named']

const PRESETS = ['default', 'notion', 'obsidian', 'vscode', 'vim', 'custom']

const LIGATURE_SCOPES = ['off', 'code', 'all']
const GLASSES_BREAKS = [0, 1, 2, 3, 4, 5, 6]
const GLASSES_EFFORTS: readonly string[] = EFFORTS

const GLASSES_COMPACTIONS = ['none', 'collapse', 'aggressive']
const GLASSES_SCROLLS = ['paged', 'native']

const GLASSES_MARKS = ['heading', 'bold', 'italic', 'strike', 'highlight', 'code', 'fence', 'link']

const MOST_WORDS = 40
const LONGEST_WORD = 60

function switchMap(name: string, allowed: readonly string[]): Check {
  return (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return `${name} must be an object`
    }

    for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.includes(key)) return `${name} has no ${key}`
      if (typeof on !== 'boolean') return `${name}.${key} must be true or false`
    }

    return null
  }
}

function phraseMap(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'glassesWords must be an object'
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MOST_WORDS) return `glassesWords holds at most ${MOST_WORDS} phrases`

  for (const [id, phrase] of entries) {
    if (id.length > LONGEST_ID || !ID.test(id)) return `${id} is not a command`
    if (typeof phrase !== 'string' || phrase.length > LONGEST_WORD) {
      return `${id} must be a phrase of at most ${LONGEST_WORD} characters`
    }
  }

  return null
}

const MOST_SPELL_WORDS = 500
const LONGEST_SPELL_WORD = 64

const SPELL_WORD = /^[\p{L}\p{N}][\p{L}\p{N}'’_-]*$/u

function wordList(value: unknown): string | null {
  if (!Array.isArray(value)) return 'spellWords must be a list of words'
  if (value.length > MOST_SPELL_WORDS) {
    return `spellWords holds at most ${MOST_SPELL_WORDS} words`
  }

  for (const word of value as unknown[]) {
    if (typeof word !== 'string' || word.length > LONGEST_SPELL_WORD || !SPELL_WORD.test(word)) {
      return 'every one of spellWords must be a single word'
    }
  }

  return null
}

const MOST_MODEL = 100

function shortEnough(name: string, most: number): Check {
  return (value) =>
    typeof value === 'string' && value.length <= most
      ? null
      : `${name} must be a string of at most ${String(most)} characters`
}

function wordOf(name: string, allowed: readonly string[]): Check {
  return (value) =>
    typeof value === 'string' && allowed.includes(value)
      ? null
      : `${name} must be one of ${allowed.join(', ')}`
}

function switched(name: string): Check {
  return (value) => (typeof value === 'boolean' ? null : `${name} must be true or false`)
}

const RECOVERY_MINUTES = [0, 1, 5, 15]
const RECOVERY_DAYS = [1, 7, 30]

const CONFLICT_RULES = ['both', 'newest', 'ask']

const LINK_FORMATS = ['wikilink', 'shortest', 'relative', 'absolute']

const PROPERTIES_MODES = ['properties', 'source', 'hidden']

function oneOf(name: string, allowed: readonly number[]): Check {
  return (value) =>
    typeof value === 'number' && allowed.includes(value)
      ? null
      : `${name} must be one of ${allowed.join(', ')}`
}

const KNOWN: Record<string, Check> = {
  ligatures: (value) =>
    typeof value === 'boolean' || (typeof value === 'string' && LIGATURE_SCOPES.includes(value))
      ? null
      : `ligatures must be true, false, or one of ${LIGATURE_SCOPES.join(', ')}`,
  glassesBreak: oneOf('glassesBreak', GLASSES_BREAKS),
  glassesLineNumbers: switched('glassesLineNumbers'),
  glassesPageNumber: switched('glassesPageNumber'),
  glassesVoice: switched('glassesVoice'),
  glassesCompaction: wordOf('glassesCompaction', GLASSES_COMPACTIONS),
  glassesScroll: wordOf('glassesScroll', GLASSES_SCROLLS),
  glassesMarks: switchMap('glassesMarks', GLASSES_MARKS),
  glassesWords: phraseMap,
  glassesSeen: switched('glassesSeen'),
  mobileSeen: switched('mobileSeen'),
  glassesModel: shortEnough('glassesModel', MOST_MODEL),
  glassesEffort: wordOf('glassesEffort', GLASSES_EFFORTS),
  vim: (value) => (typeof value === 'boolean' ? null : 'vim must be true or false'),
  attachments: (value) =>
    typeof value === 'string' && ATTACHMENT_FOLDERS.includes(value)
      ? null
      : `attachments must be one of ${ATTACHMENT_FOLDERS.join(', ')}`,
  spellWords: wordList,
  preset: (value) =>
    typeof value === 'string' && PRESETS.includes(value)
      ? null
      : `preset must be one of ${PRESETS.join(', ')}`,
  shortcuts: shortcutMap,
  toolbar: buttonList,
  pull: pulledCommand,
  hiddenKinds: kindList,
  archivedSpaces: spaceList,
  recoveryEvery: oneOf('recoveryEvery', RECOVERY_MINUTES),
  recoveryDays: oneOf('recoveryDays', RECOVERY_DAYS),
  keepVersions: oneOf('keepVersions', KEEP_DAYS),
  conflicts: wordOf('conflicts', CONFLICT_RULES),
  remindBefore: oneOf('remindBefore', REMIND_BEFORE),
  undatedInToday: switched('undatedInToday'),
  canvasTurns: switched('canvasTurns'),
  canvasTurnSnaps: switched('canvasTurnSnaps'),
  highlightTone: (value) =>
    value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
      ? null
      : 'highlightTone must be a whole number or null',
  hardBreaks: switched('hardBreaks'),
  linkFormat: wordOf('linkFormat', LINK_FORMATS),
  properties: wordOf('properties', PROPERTIES_MODES),
  chatKeywords: (value) =>
    isKeywords(value)
      ? null
      : `chatKeywords holds at most ${MOST_KEYWORDS} words of at most ${LONGEST_KEYWORD} characters`,
  chatHours: (value) =>
    value === null || isHours(value)
      ? null
      : 'chatHours must be days of the week and two minutes of the day, or null',
  chatPreviews: switched('chatPreviews'),
  chatSound: switched('chatSound'),
  quietMarks: switched('quietMarks'),
  silent: switched('silent'),
  developer: switched('developer'),
  look: lookWrong,
}

const MOST_SHORTCUTS = 200
const LONGEST_ID = 64
const LONGEST_KEY = 40
const MOST_BYTES = 8 * 1024

const MODIFIERS = new Set([
  'mod',
  'cmd',
  'meta',
  'm',
  'ctrl',
  'control',
  'c',
  'alt',
  'a',
  'option',
  'shift',
  's',
])

function isCombination(value: string): boolean {
  if (!value || value.length > LONGEST_KEY) return false
  if (/\s/.test(value) || /\p{Cc}/u.test(value)) return false

  const parts = value.split(/-(?!$)/)
  const key = parts.at(-1)
  if (!key || key.length > 16) return false

  return parts.slice(0, -1).every((modifier) => MODIFIERS.has(modifier.toLowerCase()))
}

const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

const MOST_BUTTONS = 24

function buttonList(value: unknown): string | null {
  if (value === null) return null
  if (!Array.isArray(value)) return 'toolbar must be a list of command ids or null'
  if (value.length > MOST_BUTTONS) return `toolbar holds at most ${MOST_BUTTONS} commands`

  const seen = new Set<string>()
  for (const id of value as unknown[]) {
    if (typeof id !== 'string' || id.length > LONGEST_ID || !ID.test(id)) {
      return `${String(id)} is not a command id`
    }
    if (seen.has(id)) return `${id} is on the toolbar twice`
    seen.add(id)
  }

  return null
}

const MOST_KINDS = 32
const KIND = /^[a-z][a-z-]{0,23}$/

function kindList(value: unknown): string | null {
  if (value === null) return null
  if (!Array.isArray(value)) return 'hiddenKinds must be a list of kinds or null'
  if (value.length > MOST_KINDS) return `hiddenKinds holds at most ${MOST_KINDS} kinds`

  const seen = new Set<string>()
  for (const kind of value as unknown[]) {
    if (typeof kind !== 'string' || !KIND.test(kind)) return `${String(kind)} is not a kind`
    if (seen.has(kind)) return `${kind} is in hiddenKinds twice`
    seen.add(kind)
  }

  return null
}

const MOST_ARCHIVED_SPACES = 100
const SPACE_ID = /^[A-Za-z0-9_-]{1,64}$/

function spaceList(value: unknown): string | null {
  if (!Array.isArray(value)) return 'archivedSpaces must be a list of space ids'
  if (value.length > MOST_ARCHIVED_SPACES) {
    return `archivedSpaces holds at most ${MOST_ARCHIVED_SPACES} spaces`
  }
  const seen = new Set<string>()
  for (const id of value as unknown[]) {
    if (typeof id !== 'string' || !SPACE_ID.test(id)) return `${String(id)} is not a space id`
    if (seen.has(id)) return `${id} is in archivedSpaces twice`
    seen.add(id)
  }
  return null
}

function pulledCommand(value: unknown): string | null {
  if (value === null || value === 'none') return null
  if (typeof value !== 'string' || value.length > LONGEST_ID || !ID.test(value)) {
    return 'pull must be a command id, none, or null'
  }

  return null
}

function shortcutMap(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'shortcuts must be an object'

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MOST_SHORTCUTS) return `shortcuts holds at most ${MOST_SHORTCUTS} keys`

  for (const [id, key] of entries) {
    if (id.length > LONGEST_ID || !ID.test(id)) return `${id} is not a shortcut id`
    if (key === null) continue
    if (typeof key !== 'string' || !isCombination(key))
      return `${id} is not set to a key combination`
  }

  return null
}

type AccountSettings = Record<string, unknown>

async function settingsOf(env: Env, userId: string): Promise<AccountSettings> {
  const row = await env.DB.prepare('select settings from users where id = ?')
    .bind(userId)
    .first<{ settings: string }>()
  return parse(row?.settings)
}

function parse(raw: string | undefined): AccountSettings {
  return objectIn(raw) ?? {}
}

export async function shownWords(env: Env, userId: string): Promise<string[]> {
  const hidden = (await settingsOf(env, userId)).hiddenKinds
  return Array.isArray(hidden) ? hidden.filter((one): one is string => typeof one === 'string') : []
}

export const settings = new Hono<{ Bindings: Env; Variables: Variables }>()

settings.get('/', async (context) => {
  const user = context.get('user')
  return context.json({
    settings: await settingsOf(context.env, user.id),
    key: await keyState(context.env, user.id),
  })
})

const NAMED = 64

settings.patch('/', async (context) => {
  const user = context.get('user')
  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  for (const [name, value] of Object.entries(body)) {
    const check = Object.hasOwn(KNOWN, name) ? KNOWN[name] : undefined
    if (!check) return context.json({ error: `unknown setting ${name.slice(0, NAMED)}` }, 400)

    const wrong = check(value)
    if (wrong) return context.json({ error: wrong }, 400)
  }

  const merged = { ...(await settingsOf(context.env, user.id)), ...(body as AccountSettings) }
  const written = JSON.stringify({ ...merged, look: undefined })
  if (byteLength(written) > MOST_BYTES) {
    return context.json({ error: 'that is more settings than an account holds' }, 413)
  }

  const keys = Object.keys(body)
  if (keys.length) {
    const places = keys.map(() => '?, json(?)').join(', ')
    await context.env.DB.prepare(
      `update users set settings = json_set(coalesce(settings, '{}'), ${places}) where id = ?`,
    )
      .bind(...keys.flatMap((name) => [`$."${name}"`, JSON.stringify(body[name])]), user.id)
      .run()
    await askHub(context.env, user.id, 'settings').catch(() => null)
  }
  return context.json({ settings: await settingsOf(context.env, user.id) })
})
