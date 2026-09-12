/** What the extension remembers about the interpreter.
 *
 *  One entry in `chrome.storage.local` under `nib:interpreter`, read through
 *  `settings.ts` like everything else, and checked here on the way in because
 *  storage was written by some version of this extension and possibly an older
 *  one.
 *
 *  **The keys are in `chrome.storage.local`, which Chrome does not encrypt.** An
 *  extension has no keychain to put them in: MV3 gives a service worker and two
 *  pages, and storage is the only place all three can look. Anything else - the
 *  session's own token included - is in there too. So the options page says it in
 *  a sentence rather than leaving it to be found out, a key is only ever sent to
 *  the provider it belongs to, and a key kept per provider means switching from
 *  one to another and back does not quietly leave the wrong one in the field.
 *
 *  Which provider is chosen is also the on switch: null is the state a fresh
 *  install is in, and in that state the clipper is exactly what it was before any
 *  of this - no row in the popup, no request, nothing sent anywhere. */

import { isRecord, isString } from '../stored'
import { PROVIDER_IDS, PROVIDERS, type ProviderId, type Setup } from './providers'
import { TEMPLATES } from './templates'

export interface Interpreter {
  /** Null for off, which is where an install starts. */
  provider: ProviderId | null
  /** By provider, so one is not lost by trying another. */
  keys: Record<string, string>
  models: Record<string, string>
  /** Where the compatible provider answers; the other two answer in one place. */
  address: string
  /** The templates as the text the options page edits; see `templates.ts`. */
  templates: string
  /** Whether Interpret is on, by template name. */
  on: Record<string, boolean>
}

export const NO_INTERPRETER: Interpreter = {
  provider: null,
  keys: {},
  models: {},
  address: PROVIDERS.compatible.base,
  templates: TEMPLATES,
  on: {},
}

/** A map of strings, with every entry that is not one left out. */
function strings(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [name, one] of Object.entries(value)) if (isString(one)) out[name] = one

  return out
}

/** A map of switches. Only `true` is kept: everything else is off, and off is
 *  what a name that is not there means anyway. */
function flags(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {}

  const out: Record<string, boolean> = {}
  for (const [name, one] of Object.entries(value)) if (one === true) out[name] = true

  return out
}

export function readInterpreter(value: unknown): Interpreter {
  if (!isRecord(value)) return NO_INTERPRETER

  const chosen = PROVIDER_IDS.find((one) => one === value.provider) ?? null
  const templates = isString(value.templates) ? value.templates : ''
  const address = isString(value.address) ? value.address : ''

  return {
    provider: chosen,
    keys: strings(value.keys),
    models: strings(value.models),
    address: address || NO_INTERPRETER.address,
    templates: templates.trim() ? templates : TEMPLATES,
    on: flags(value.on),
  }
}

/** The chosen provider as something to ask, or null when none is chosen. */
export function setupOf(held: Interpreter): Setup | null {
  if (!held.provider) return null

  return {
    provider: held.provider,
    key: held.keys[held.provider] ?? '',
    address: held.address,
    model: held.models[held.provider] ?? PROVIDERS[held.provider].model,
  }
}
