import { isRecord, keepJson, stored } from '../stored'
import { invoke, platform } from '../tauri'
import { declared } from './declared.svelte'
import type { Field } from './fields'
import { type Platform, refusal, type Schema, schemaOf } from './file-schema'
import { sendAsSaid, sendInstead } from './held'
import { bare, hold, releaseAll } from './hold'

interface SettingsFile {
  path: string
  text: string
}

type Value = boolean | number | string

const OWN_KEY = 'nib:declared-own'

interface Own {
  value: unknown
  part?: unknown
}

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
  keepJson(OWN_KEY, own)
}

function nameOf(field: Field): string {
  return field.member === undefined ? (field.key ?? '') : `${field.key ?? ''}\u0000${field.member}`
}

const PASSES = 3

type Named = readonly [key: string, value: unknown]

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

function put(field: Field, value: Value): void {
  if (field.kind === 'value' || field.kind === 'picture') return
  const one = field as { get(): Value; set(value: Value): void }
  if (one.get() !== value) one.set(value)
}

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
  hold(store, (whole) => {
    own[name] = {
      value: bare(() => (field.kind === 'value' ? null : field.get())),
      part: store.take ? store.take(whole) : whole,
    }
    remember()
  })
}

function givenBack(fields: Field[], named: ReadonlySet<string>): void {
  let changed = false
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

function checked(fields: Field[], value: unknown): string | null {
  for (const one of fields) {
    const why = typeof value === 'string' ? (one.check?.(value) ?? null) : null
    if (why !== null) return why
  }
  return null
}

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
    if (Object.keys(own).length) givenBack(await fields(), new Set())
    return
  }
  declared.path = file.path

  const settings = settingsIn(file.text)
  if (typeof settings === 'string') {
    declared.said([`${file.path} is not valid JSON: ${settings}`])
    return
  }
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
  const keys = new Set(settings.map(([key]) => key))
  const still = new Set(Object.keys(own).filter((name) => keys.has(name.split('\u0000')[0] ?? '')))
  if (Object.keys(own).length > still.size) givenBack(built.length ? built : await fields(), still)
  const here = platform() as Platform
  const everywhere = left.length
    ? ((await import('../../../../../packaging/nix/settings-schema.json')).default as Schema)
    : {}
  for (const [key] of left) {
    const known = everywhere[key]
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

export async function declare(open: () => void): Promise<void> {
  await load(async () => {
    await (await import('./dns.svelte')).dns.ask()
    return (await import('./declarations')).declarations()
  })
  declared.tell(open)
}
