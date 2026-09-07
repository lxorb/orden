import { Hono } from 'hono'
import type { Env, Variables } from './types'

/** The settings that follow the account from machine to machine, and what
 *  each may be. Anything else in a request is refused, so the column never
 *  holds what no version of the app knows what to do with.
 *
 *  Each entry says what is wrong rather than only that something is, because
 *  the message is what the app shows: see the ERROR path in api.ts. */
type Check = (value: unknown) => string | null

/** Where the app writes a pasted picture. Named rather than described, because
 *  the folder itself is worked out on the machine that has the note. */
const ATTACHMENT_FOLDERS = ['space', 'note', 'named']

/** Which keyboard a shortcut map is. Named rather than described: what each
 *  one holds is the app's business, and `custom` is a map somebody put together
 *  themselves. A list rather than any string, because this one is shown as a
 *  word and an account should not be able to carry a sentence into a select. */
const PRESETS = ['default', 'notion', 'obsidian', 'vim', 'custom']

const KNOWN: Record<string, Check> = {
  ligatures: (value) => (typeof value === 'boolean' ? null : 'ligatures must be true or false'),
  vim: (value) => (typeof value === 'boolean' ? null : 'vim must be true or false'),
  attachments: (value) =>
    typeof value === 'string' && ATTACHMENT_FOLDERS.includes(value)
      ? null
      : `attachments must be one of ${ATTACHMENT_FOLDERS.join(', ')}`,
  preset: (value) =>
    typeof value === 'string' && PRESETS.includes(value)
      ? null
      : `preset must be one of ${PRESETS.join(', ')}`,
  shortcuts: shortcutMap,
}

/** How much of any of this an account may hold.
 *
 *  The column is one JSON blob on the user's row, and a shortcut map is the
 *  first thing in it that a client could grow without limit - an id is a
 *  string the server never chose. So the count, the length of every part and
 *  the size of the whole are all bounded, and the bounds are generous enough
 *  that a person rebinding every shortcut there is stays well inside them:
 *  the app has around ninety. */
const MOST_SHORTCUTS = 200
const LONGEST_ID = 64
const LONGEST_KEY = 40
const MOST_BYTES = 8 * 1024

/** The modifiers a combination may name. `Mod` is Cmd on a Mac and Ctrl
 *  everywhere else, which is why what is stored says `Mod` rather than either
 *  of them: one account, two kinds of machine. */
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

/** Whether a string is a key combination in CodeMirror's notation.
 *
 *  Split on every `-` except a trailing one, the way CodeMirror splits it, so
 *  `Mod--` reads as Mod and the minus key rather than as Mod and nothing. */
function isCombination(value: string): boolean {
  if (!value || value.length > LONGEST_KEY) return false
  // Nothing a keyboard produces has whitespace or a control character in its
  // name, and neither does any modifier.
  if (/\s/.test(value) || /\p{Cc}/u.test(value)) return false

  const parts = value.split(/-(?!$)/)
  const key = parts.at(-1)
  if (!key || key.length > 16) return false

  return parts.slice(0, -1).every((modifier) => MODIFIERS.has(modifier.toLowerCase()))
}

/** An id the app files a key under: lower case, in dotted parts. Checked
 *  rather than matched against a list, because the list lives in the app and
 *  a server that knew it would have to be deployed before every new
 *  shortcut. An id this version has never heard of is kept and handed back;
 *  nothing here has to know what it means. */
const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

function shortcutMap(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'shortcuts must be an object'

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MOST_SHORTCUTS) return `shortcuts holds at most ${MOST_SHORTCUTS} keys`

  for (const [id, key] of entries) {
    if (id.length > LONGEST_ID || !ID.test(id)) return `${id} is not a shortcut id`
    // Null is a key taken away, which is a choice like any other and has to
    // travel: without it a machine could never learn that another one
    // unbound something.
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
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as AccountSettings)
      : {}
  } catch {
    return {}
  }
}

export const settings = new Hono<{ Bindings: Env; Variables: Variables }>()

settings.get('/', async (context) => {
  return context.json({ settings: await settingsOf(context.env, context.get('user').id) })
})

/** Changes what is sent and leaves the rest as it was. */
settings.patch('/', async (context) => {
  const user = context.get('user')
  const body = await context.req.json<unknown>().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return context.json({ error: 'send an object' }, 400)
  }

  for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
    // Asked of the map itself, never through it: `KNOWN['__proto__']` reaches
    // Object's own and would be called as though it were a check.
    const check = Object.hasOwn(KNOWN, name) ? KNOWN[name] : undefined
    if (!check) return context.json({ error: `unknown setting ${name}` }, 400)

    const wrong = check(value)
    if (wrong) return context.json({ error: wrong }, 400)
  }

  const merged = { ...(await settingsOf(context.env, user.id)), ...(body as AccountSettings) }
  const written = JSON.stringify(merged)
  // Measured on what would be stored rather than on what arrived: a patch
  // small enough on its own can still be the one that tips the column over.
  if (new TextEncoder().encode(written).length > MOST_BYTES) {
    return context.json({ error: 'that is more settings than an account holds' }, 413)
  }

  await context.env.DB.prepare('update users set settings = ? where id = ?')
    .bind(written, user.id)
    .run()
  return context.json({ settings: merged })
})
