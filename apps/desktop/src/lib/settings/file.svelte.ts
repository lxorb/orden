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
 *  The file is JSON, its settings by the keys the panes declare, either nested by pane
 *  (`{ "editor": { "textSize": 1.1 } }`) or written out (`{ "editor.textSize": 1.1 }`);
 *  file-schema.ts says what each may be. A file that cannot be read, is not JSON, or
 *  names a setting wrongly is said in a notice and at the top of Settings, with what is
 *  wrong and where - never by not starting. What is right in it still applies. */

import { t } from '../i18n.svelte'
import { log } from '../log'
import { notify } from '../notify'
import { invoke } from '../tauri'
import type { Field, Pane } from './fields'
import { refusal, settingOf } from './file-schema'

/** What the crate reads: the file and where it is, or nothing where there is none. */
interface SettingsFile {
  path: string
  text: string
}

type Value = boolean | number | string

/** How many times the panes are built while settings are put in force; see `load`. */
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

/** Every field in the panes. */
function fieldsOf(panes: Pane[]): Field[] {
  return panes.flatMap((pane) => pane.groups.flatMap((group) => group.fields))
}

/** A field set to `value`, which its schema has taken. A switch's setter may be a
 *  toggle, so only a field that differs is set; see reset-fields.ts. */
function put(field: Field, value: Value): void {
  if (field.kind === 'value' || field.kind === 'picture') return
  const one = field as { get(): Value; set(value: Value): void }
  if (one.get() !== value) one.set(value)
}

class DeclaredSettings {
  /** Where the file is, once one was found. */
  path = $state<string | null>(null)
  /** The keys the file holds in force. */
  held = $state<ReadonlySet<string>>(new Set())
  /** What is wrong with the file, one line each, in the file's own terms. */
  problems = $state<string[]>([])

  /** Reads the file and puts what it says in force, against the panes `panes` builds.
   *  No file is nothing to do. */
  async load(panes: () => Promise<Pane[]>): Promise<void> {
    this.path = null
    this.held = new Set()
    this.problems = []
    let file: SettingsFile | null
    try {
      file = await invoke<SettingsFile | null>('read_settings_file')
    } catch (error) {
      this.said([error instanceof Error ? error.message : String(error)])
      return
    }
    if (!file) return
    this.path = file.path

    const settings = settingsIn(file.text)
    if (typeof settings === 'string') {
      this.said([`${file.path} is not valid JSON: ${settings}`])
      return
    }
    // Some rows are there only once another is: the terminal's under Developer mode.
    // So the panes are built again after each pass that put something in force, until
    // one finds nothing more; whatever is left names no setting at all.
    const held = new Set<string>()
    const problems: string[] = []
    let left = settings
    for (let pass = 0; pass < PASSES && left.length; pass++) {
      const before = left.length
      left = this.applied(left, fieldsOf(await panes()), held, problems)
      if (left.length === before) break
    }
    for (const [key] of left) problems.push(`${key} is not a setting Orden knows`)
    this.held = held
    if (problems.length) this.said(problems)
  }

  /** What is wrong, said once as the app starts, as a notice that opens Settings - where
   *  the same lines stand at the top - since a setting that quietly did not apply is a
   *  configuration that seems to do nothing. The detail is the file's own terms, keys
   *  and JSON, so it stays as written rather than translated. */
  tell(open: () => void): void {
    if (!this.problems.length) return
    notify(t('The settings file has a problem'), this.problems.join('\n'), 'settings-file', open)
  }

  /** Puts in force every setting the fields have a row for, and says each it cannot
   *  be set to; answers the ones they have no row for. */
  private applied(
    settings: Named[],
    fields: Field[],
    held: Set<string>,
    problems: string[],
  ): Named[] {
    const left: Named[] = []
    for (const [key, value] of settings) {
      const field = fields.find((one) => one.key === key)
      const setting = field ? settingOf(field) : null
      if (!field || !setting) {
        left.push([key, value])
        continue
      }
      const why = refusal(setting, value)
      if (why !== null) {
        problems.push(`${key} ${why}`)
        continue
      }
      try {
        put(field, value as Value)
        held.add(key)
      } catch (error) {
        problems.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return left
  }

  /** What the row for `field` is now: as it was, or held by the file, its control
   *  doing nothing. */
  lock(field: Field): Field {
    if (!field.key || !this.held.has(field.key) || !this.path) return field
    const declared = this.path
    switch (field.kind) {
      case 'switch':
        return { ...field, declared, locked: () => true, set: () => undefined }
      case 'slider':
        return { ...field, declared, preview: () => undefined, set: () => undefined }
      case 'swatches': {
        // Nor the two colours of the reader's own after the swatches.
        const rest = { ...field }
        delete rest.pair
        return { ...rest, declared, set: () => undefined }
      }
      case 'select':
      case 'segmented':
      case 'text':
        return { ...field, declared, set: () => undefined }
      case 'picture':
      case 'value':
        return field
    }
  }

  private said(problems: string[]): void {
    this.problems = problems
    for (const one of problems) log('warn', `settings file: ${one}`)
  }
}

export const declared = new DeclaredSettings()

/** At launch, on a desktop: the file put in force over what the stores restored, and
 *  what is wrong with it said. The DNS row is there once the crate has said which
 *  engine this is, so that is waited for; the panes are fetched only now. */
export async function declare(open: () => void): Promise<void> {
  await declared.load(async () => {
    await (await import('./dns.svelte')).dns.ask()
    return (await import('../preferences')).declaredPanes()
  })
  declared.tell(open)
}
