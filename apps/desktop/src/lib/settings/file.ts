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
 *  The file is JSON, its settings by the keys declarations.ts gathers, either nested
 *  (`{ "editor": { "textSize": 1.1 } }`) or written out (`{ "editor.textSize": 1.1 }`);
 *  file-schema.ts says what each may be. A setting of another platform's is passed over
 *  without a word, so one file serves every machine. A file that cannot be read, is not
 *  JSON, or names a setting wrongly is said in a notice and at the top of Settings,
 *  with what is wrong and where - never by not starting. What is right still applies. */

import { invoke, platform } from '../tauri'
import { declared } from './declared.svelte'
import type { Field } from './fields'
import { type Platform, refusal, type Schema, schemaOf } from './file-schema'
import { declaringWhile, hold, releaseAll } from './hold'

/** What the crate reads: the file and where it is, or nothing where there is none. */
interface SettingsFile {
  path: string
  text: string
}

type Value = boolean | number | string

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
        for (const one of members) put(one, listed.includes(one.member ?? ''))
        for (const one of members) if (one.store) hold(one.store)
      } else {
        const [one] = named
        if (one) {
          put(one, value as Value)
          if (one.store) hold(one.store)
        }
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
  if (!file) return
  declared.path = file.path

  const settings = settingsIn(file.text)
  if (typeof settings === 'string') {
    declared.said([`${file.path} is not valid JSON: ${settings}`])
    return
  }
  // Some rows are there only once another is: the terminal's under Developer mode.
  // So the panes are built again after each pass that put something in force, until
  // one finds nothing more; whatever is left names no setting at all.
  const held = new Set<string>()
  const problems: string[] = []
  let left = settings
  await declaringWhile(async () => {
    for (let pass = 0; pass < PASSES && left.length; pass++) {
      const before = left.length
      left = applied(left, await fields(), held, problems)
      if (left.length === before) break
    }
  })
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
