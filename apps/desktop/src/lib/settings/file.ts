/** The settings file (#673): settings a configuration declares rather than somebody
 *  sets, read once at launch from `settings.json` in the settings folder.
 *
 *  What NixOS wanted: Home Manager's `programs.orden.settings` writes the file (see
 *  packaging/nix/flake.nix), and the app follows it. Each setting it names is put in
 *  force as the app starts and held there: its row in Settings shows the value, says it
 *  comes from the file, and does nothing when pressed, so what the configuration says
 *  is what the app does until the configuration changes. Change the file and start the
 *  app again, and it follows.
 *
 *  Held where the value is kept, not where it is shown (hold.ts): a key, the palette, a
 *  menu or another device's value arriving through the account writes beneath it, and
 *  the app goes on reading the file's.
 *
 *  The reader's own value is remembered beside it (`OWN_KEY`): what the setting was when
 *  the file first held it, and whatever is written beneath it since. That is what the
 *  account is sent in the file's place (held.ts), and what the setting is given back
 *  when the file stops naming it, at the next launch.
 *
 *  The file is JSON, its settings by the keys declarations.ts gathers, either nested
 *  (`{ "editor": { "textSize": 1.1 } }`) or written out (`{ "editor.textSize": 1.1 }`);
 *  file-schema.ts says what each may be. A setting of another platform's is passed over
 *  without a word, so one file serves every machine. A file that cannot be read, is not
 *  JSON, or names a setting wrongly is said in a notice and at the top of Settings,
 *  with what is wrong and where - never by not starting. What is right still applies. */

import { isRecord, keep, stored } from '../stored'
import { invoke, platform } from '../tauri'
import { declared } from './declared.svelte'
import type { Field } from './fields'
import { type Platform, refusal, type Schema, schemaOf } from './file-schema'
import { sendAsSaid, sendInstead } from './held'
import { bare, hold, releaseAll } from './hold'

/** What the crate reads: the file and where it is, or nothing where there is none. */
interface SettingsFile {
  path: string
  text: string
}

type Value = boolean | number | string

/** Where the reader's own value of each held setting is remembered: what it is as Settings
 *  shows it (`value`, to give back), and as its store keeps it (`part`, to send). */
const OWN_KEY = 'nib:declared-own'

interface Own {
  value: unknown
  part?: unknown
}

/** The reader's own values, by `nameOf`. */
let own: Record<string, Own> = {}

function remembered(): Record<string, Own> {
  const kept = stored(OWN_KEY)
  return isRecord(kept)
    ? (Object.fromEntries(Object.entries(kept).filter(([, one]) => isRecord(one))) as Record<
        string,
        Own
      >)
    : {}
}

function remember(): void {
  keep(OWN_KEY, JSON.stringify(own))
}

/** A field's name among the remembered: its key, and a list's member after it. */
function nameOf(field: Field): string {
  return field.member === undefined ? (field.key ?? '') : `${field.key ?? ''}\u0000${field.member}`
}

/** How many times the fields are built while settings are put in force; see `load`. */
const PASSES = 3

/** One setting the file names, by its key, and what it says. */
type Named = readonly [key: string, value: unknown]

/** The file's settings by key, nested objects written out as `pane.setting`, or why
 *  the text is not that. */
function settingsIn(text: string): Named[] | string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  if (!isObject(parsed)) return 'it should be a JSON object of settings'

  const found: Named[] = []
  const walk = (object: Record<string, unknown>, before: string) => {
    for (const [name, value] of Object.entries(object)) {
      const key = before ? `${before}.${name}` : name
      if (isObject(value)) walk(value, key)
      else found.push([key, value])
    }
  }
  walk(parsed, '')
  return found
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A field set to `value`, which its schema has taken. A switch's setter may be a
 *  toggle, so only a field that differs is set; see reset-fields.ts. */
function put(field: Field, value: Value): void {
  if (field.kind === 'value' || field.kind === 'picture') return
  const one = field as { get(): Value; set(value: Value): void }
  if (one.get() !== value) one.set(value)
}

/** Puts `value` in force on `field` and holds it there, remembering the reader's own
 *  first: the field as it was, unless a launch before this one already remembered it -
 *  by now the store holds the file's value, which it was left with. */
function declareOn(field: Field, value: Value): void {
  const store = field.store
  const name = nameOf(field)
  if (!(name in own) && store) {
    const whole: unknown = Reflect.get(store.on, store.name)
    own[name] = {
      value: field.kind === 'value' ? null : field.get(),
      part: store.take ? store.take(whole) : whole,
    }
    remember()
  }
  if (store?.shared) {
    const shared = store.shared
    sendInstead(shared, (sent) => {
      const mine = own[name]
      if (!mine) return sent
      return store.put ? store.put(sent, mine.part) : mine.part
    })
  }
  if (field.declare) (field.declare as (value: Value) => void)(value)
  else put(field, value)
  if (!store) return
  // Written beneath while held - its key pressed, another device's value come in - is
  // the reader's own from then on.
  hold(store, (whole) => {
    own[name] = {
      value: bare(() => (field.kind === 'value' ? null : field.get())),
      part: store.take ? store.take(whole) : whole,
    }
    remember()
  })
}

/** The settings the file no longer names, given back what the reader had: each one this
 *  launch has a field for. The crate's own (Hardware acceleration) is the crate's to give
 *  back, as it reads the file itself. */
function givenBack(fields: Field[], named: ReadonlySet<string>): void {
  let changed = false
  // A list's members on before any goes off, as it was put in force: the last
  // dictionary on cannot be turned off.
  const back = Object.entries(own).sort(
    ([, a], [, b]) => Number(b.value === true) - Number(a.value === true),
  )
  for (const [name, mine] of back) {
    if (named.has(name)) continue
    const field = fields.find((one) => nameOf(one) === name)
    if (!field) continue
    if (!field.declare) put(field, mine.value as Value)
    Reflect.deleteProperty(own, name)
    changed = true
  }
  if (changed) remember()
}

/** Why a field's own check refuses `value`, or null. */
function checked(fields: Field[], value: unknown): string | null {
  for (const one of fields) {
    const why = typeof value === 'string' ? (one.check?.(value) ?? null) : null
    if (why !== null) return why
  }
  return null
}

/** Puts in force every setting the fields have a row for, and says each it cannot
 *  be set to; answers the ones they have no row for. */
function applied(
  settings: Named[],
  fields: Field[],
  held: Set<string>,
  problems: string[],
): Named[] {
  const left: Named[] = []
  for (const [key, value] of settings) {
    const named = fields.filter((one) => one.key === key)
    const setting = schemaOf(named)[key]
    if (!named.length || !setting) {
      left.push([key, value])
      continue
    }
    const why = refusal(setting, value) ?? checked(named, value)
    if (why !== null) {
      problems.push(`${key} ${why}`)
      continue
    }
    try {
      if (setting.type === 'list') {
        // A list's members: those in it on first, so the last one on is never turned
        // off on the way.
        const listed = value as string[]
        const members = [...named].sort(
          (a, b) =>
            Number(listed.includes(b.member ?? '')) - Number(listed.includes(a.member ?? '')),
        )
        for (const one of members) declareOn(one, listed.includes(one.member ?? ''))
      } else {
        const [one] = named
        if (one) declareOn(one, value as Value)
      }
      held.add(key)
    } catch (error) {
      problems.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return left
}

/** Reads the file and puts what it says in force, through the fields `fields` builds.
 *  No file is nothing to do. */
export async function load(fields: () => Promise<Field[]>): Promise<void> {
  releaseAll()
  sendAsSaid()
  own = remembered()
  declared.path = null
  declared.held = new Set()
  declared.problems = []
  let file: SettingsFile | null
  try {
    file = await invoke<SettingsFile | null>('read_settings_file')
  } catch (error) {
    declared.said([error instanceof Error ? error.message : String(error)])
    return
  }
  if (!file) {
    // No file at all: everything it held is the reader's again.
    if (Object.keys(own).length) givenBack(await fields(), new Set())
    return
  }
  declared.path = file.path

  const settings = settingsIn(file.text)
  if (typeof settings === 'string') {
    // Nothing held, and nothing given back either: a file being written is not a file
    // that stopped saying anything.
    declared.said([`${file.path} is not valid JSON: ${settings}`])
    return
  }
  // Some rows are there only once another is: the terminal's under Developer mode.
  // So the panes are built again after each pass that put something in force, until
  // one finds nothing more; whatever is left names no setting at all.
  const held = new Set<string>()
  const problems: string[] = []
  let left = settings
  let built: Field[] = []
  for (let pass = 0; pass < PASSES && left.length; pass++) {
    const before = left.length
    built = await fields()
    left = applied(left, built, held, problems)
    if (left.length === before) break
  }
  // What the file still names, member by member, keeps what is remembered of it.
  const keys = new Set(settings.map(([key]) => key))
  const still = new Set(Object.keys(own).filter((name) => keys.has(name.split('\u0000')[0] ?? '')))
  if (Object.keys(own).length > still.size) givenBack(built.length ? built : await fields(), still)
  const here = platform() as Platform
  // Every setting there is, on every platform: fetched only where something is left.
  const everywhere = left.length
    ? ((await import('../../../../../packaging/nix/settings-schema.json')).default as Schema)
    : {}
  for (const [key] of left) {
    const known = everywhere[key]
    // Another platform's, which the same file may well carry.
    if (known?.platforms && !known.platforms.includes(here)) continue
    problems.push(
      known
        ? `${key} is not a setting here now: what it depends on is off`
        : `${key} is not a setting Orden knows`,
    )
  }
  declared.held = held
  if (problems.length) declared.said(problems)
}

/** At launch, on a desktop: the file put in force over what the stores restored, and
 *  what is wrong with it said. The DNS row is there once the crate has said which
 *  engine this is, so that is waited for; the panes are fetched only now. */
export async function declare(open: () => void): Promise<void> {
  await load(async () => {
    await (await import('./dns.svelte')).dns.ask()
    return (await import('./declarations')).declarations()
  })
  declared.tell(open)
}
