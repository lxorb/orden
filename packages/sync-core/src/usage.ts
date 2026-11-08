export const USAGE_OS = ['macos', 'windows', 'linux', 'ios', 'android', 'other'] as const
export const USAGE_ARCH = ['x86_64', 'aarch64', 'x86', 'arm', 'other'] as const
export const USAGE_FORM = ['desktop', 'mobile', 'web'] as const
export const USAGE_ENGINE = ['webkit', 'webview2', 'chromium', 'gecko', 'other'] as const
export const USAGE_CHANNEL = ['stable', 'unstable'] as const
export const USAGE_SCREEN = ['small', 'medium', 'large', 'huge'] as const
export const USAGE_VIA = ['shortcut', 'menu', 'button', 'palette'] as const
export const USAGE_SIZE = ['0', '1-9', '10-99', '100-999', '1000+'] as const
export const USAGE_STARTUP = ['under-1s', '1-2s', '2-5s', 'over-5s'] as const

export type UsageVia = (typeof USAGE_VIA)[number]
export type UsageSize = (typeof USAGE_SIZE)[number]
export type UsageStartup = (typeof USAGE_STARTUP)[number]

export const MOST_USAGE_EVENTS = 64
export const MOST_USAGE_KEYS = 400
export const MOST_USAGE_COUNT = 1_000_000
export const USAGE_DAYS_KEPT = 30

const NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const SETTING = /^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/
const MOST_NAME = 64
const DAY = /^\d{4}-\d{2}-\d{2}$/
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9a-z.]{1,24})?$/
const OS_VERSION = /^\d{1,5}(?:\.\d{1,5})?$/
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,4}){0,2}$/
const INSTALL = /^[0-9a-f]{32}$/

export interface UsageApp {
  version: string
  channel: (typeof USAGE_CHANNEL)[number]
}

export interface UsageSystem {
  os: (typeof USAGE_OS)[number]
  osVersion?: string
  arch: (typeof USAGE_ARCH)[number]
  form: (typeof USAGE_FORM)[number]
  engine: (typeof USAGE_ENGINE)[number]
}

interface UsageCommon {
  v: 1
  day: string
  app: UsageApp
  system: UsageSystem
  language: string
  screen: (typeof USAGE_SCREEN)[number]
  signedIn: boolean
}

export interface DailyPing extends UsageCommon {
  kind: 'daily'
}

export interface UsageSizes {
  notes: UsageSize
  spaces: UsageSize
  tabs: UsageSize
}

export interface UsageDay extends UsageCommon {
  kind: 'usage'
  install: string
  commands: Record<string, Partial<Record<UsageVia, number>>>
  features: Record<string, number>
  tabs: Record<string, number>
  settings: Record<string, Record<string, number>>
  onboarding: Record<string, number>
  startup: Partial<Record<UsageStartup, number>>
  sizes: UsageSizes
}

export type UsageEvent = DailyPing | UsageDay

export interface UsageBatch {
  events: UsageEvent[]
}

export const USAGE_FIELDS = {
  batch: ['events'],
  daily: ['v', 'kind', 'day', 'app', 'system', 'language', 'screen', 'signedIn'],
  usage: [
    'v',
    'kind',
    'day',
    'app',
    'system',
    'language',
    'screen',
    'signedIn',
    'install',
    'commands',
    'features',
    'tabs',
    'settings',
    'onboarding',
    'startup',
    'sizes',
  ],
  app: ['version', 'channel'],
  system: ['os', 'osVersion', 'arch', 'form', 'engine'],
  sizes: ['notes', 'spaces', 'tabs'],
} as const

class Refused extends Error {}

type Raw = Record<string, unknown>

function objectOf(value: unknown, label: string): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Refused(`${label} must be an object`)
  }
  return value as Raw
}

function only(value: unknown, label: string, allowed: readonly string[]): Raw {
  const raw = objectOf(value, label)
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new Refused(`${label}.${key} is not a field that is taken`)
  }
  return raw
}

function oneOf<T extends string>(value: unknown, label: string, among: readonly T[]): T {
  const found = among.find((one) => one === value)
  if (found === undefined) throw new Refused(`${label} must be one of ${among.join(', ')}`)
  return found
}

function shaped(value: unknown, label: string, pattern: RegExp, most: number): string {
  if (typeof value !== 'string' || value.length > most || !pattern.test(value)) {
    throw new Refused(`${label} is not in the expected form`)
  }
  return value
}

function countOf(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Refused(`${label} must be a whole number`)
  }
  return Math.min(value, MOST_USAGE_COUNT)
}

function flagOf(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Refused(`${label} must be true or false`)
  return value
}

function entriesOf(value: unknown, label: string): [string, unknown][] {
  const entries = Object.entries(objectOf(value, label))
  if (entries.length > MOST_USAGE_KEYS) throw new Refused(`${label} has too many entries`)
  return entries
}

function countsOf(value: unknown, label: string, pattern: RegExp = NAME): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [key, many] of entriesOf(value, label)) {
    counts[shaped(key, `${label} key`, pattern, MOST_NAME)] = countOf(many, `${label}.${key}`)
  }
  return counts
}

function commandsOf(value: unknown): UsageDay['commands'] {
  const commands: UsageDay['commands'] = {}
  for (const [id, ways] of entriesOf(value, 'commands')) {
    const label = `commands.${id}`
    const counted: Partial<Record<UsageVia, number>> = {}
    for (const [via, many] of Object.entries(only(ways, label, USAGE_VIA))) {
      counted[oneOf(via, `${label} way`, USAGE_VIA)] = countOf(many, `${label}.${via}`)
    }
    commands[shaped(id, 'commands key', NAME, MOST_NAME)] = counted
  }
  return commands
}

function settingsOf(value: unknown): UsageDay['settings'] {
  const settings: UsageDay['settings'] = {}
  for (const [id, values] of entriesOf(value, 'settings')) {
    settings[shaped(id, 'settings key', SETTING, MOST_NAME)] = countsOf(values, `settings.${id}`)
  }
  return settings
}

function startupOf(value: unknown): UsageDay['startup'] {
  const startup: UsageDay['startup'] = {}
  for (const [bucket, many] of Object.entries(only(value, 'startup', USAGE_STARTUP))) {
    startup[oneOf(bucket, 'startup bucket', USAGE_STARTUP)] = countOf(many, `startup.${bucket}`)
  }
  return startup
}

function sizesOf(value: unknown): UsageSizes {
  const sizes = only(value, 'sizes', USAGE_FIELDS.sizes)
  return {
    notes: oneOf(sizes.notes, 'sizes.notes', USAGE_SIZE),
    spaces: oneOf(sizes.spaces, 'sizes.spaces', USAGE_SIZE),
    tabs: oneOf(sizes.tabs, 'sizes.tabs', USAGE_SIZE),
  }
}

function appOf(value: unknown): UsageApp {
  const app = only(value, 'app', USAGE_FIELDS.app)
  return {
    version: shaped(app.version, 'app.version', VERSION, 40),
    channel: oneOf(app.channel, 'app.channel', USAGE_CHANNEL),
  }
}

function systemOf(value: unknown): UsageSystem {
  const system = only(value, 'system', USAGE_FIELDS.system)
  return {
    os: oneOf(system.os, 'system.os', USAGE_OS),
    ...(system.osVersion === undefined
      ? {}
      : { osVersion: shaped(system.osVersion, 'system.osVersion', OS_VERSION, 11) }),
    arch: oneOf(system.arch, 'system.arch', USAGE_ARCH),
    form: oneOf(system.form, 'system.form', USAGE_FORM),
    engine: oneOf(system.engine, 'system.engine', USAGE_ENGINE),
  }
}

function commonOf(raw: Raw): UsageCommon {
  if (raw.v !== 1) throw new Refused('v must be 1')
  return {
    v: 1,
    day: shaped(raw.day, 'day', DAY, 10),
    app: appOf(raw.app),
    system: systemOf(raw.system),
    language: shaped(raw.language, 'language', LANGUAGE, 16),
    screen: oneOf(raw.screen, 'screen', USAGE_SCREEN),
    signedIn: flagOf(raw.signedIn, 'signedIn'),
  }
}

function eventOf(value: unknown): UsageEvent {
  const kind = objectOf(value, 'event').kind
  if (kind === 'daily') {
    return { ...commonOf(only(value, 'daily', USAGE_FIELDS.daily)), kind: 'daily' }
  }
  if (kind !== 'usage') throw new Refused('kind must be daily or usage')

  const raw = only(value, 'usage', USAGE_FIELDS.usage)
  return {
    ...commonOf(raw),
    kind: 'usage',
    install: shaped(raw.install, 'install', INSTALL, 32),
    commands: commandsOf(raw.commands),
    features: countsOf(raw.features, 'features'),
    tabs: countsOf(raw.tabs, 'tabs'),
    settings: settingsOf(raw.settings),
    onboarding: countsOf(raw.onboarding, 'onboarding'),
    startup: startupOf(raw.startup),
    sizes: sizesOf(raw.sizes),
  }
}

export function usageEventOf(value: unknown): UsageEvent | string {
  try {
    return eventOf(value)
  } catch (error) {
    if (error instanceof Refused) return error.message
    throw error
  }
}

export function usageBatchOf(value: unknown): UsageBatch | string {
  try {
    const raw = only(value, 'batch', USAGE_FIELDS.batch)
    if (!Array.isArray(raw.events)) throw new Refused('events must be a list')
    if (raw.events.length > MOST_USAGE_EVENTS) throw new Refused('too many events at once')
    return { events: raw.events.map(eventOf) }
  } catch (error) {
    if (error instanceof Refused) return error.message
    throw error
  }
}

export function usageName(id: string): string | null {
  const base = id.split(':')[0] ?? ''
  return base.length <= MOST_NAME && NAME.test(base) ? base : null
}

export function settingName(id: string): string | null {
  return id.length <= MOST_NAME && SETTING.test(id) ? id : null
}

export function sizeOf(count: number): UsageSize {
  if (count <= 0) return '0'
  if (count < 10) return '1-9'
  if (count < 100) return '10-99'
  if (count < 1000) return '100-999'
  return '1000+'
}

export function startupOfMs(ms: number): UsageStartup {
  if (ms < 1000) return 'under-1s'
  if (ms < 2000) return '1-2s'
  if (ms < 5000) return '2-5s'
  return 'over-5s'
}

export function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
