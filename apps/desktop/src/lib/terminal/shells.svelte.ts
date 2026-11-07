import { t } from '../i18n.svelte'
import { withOrWithout } from '../records'
import { isRecord, keep, keepJson, stored, storedText } from '../stored'
import { invoke, isDesktop } from '../tauri'

export interface Shell {
  id: string
  name: string
}

const SHELL_KEY = 'orden:terminal-shell'
const SIZE_KEY = 'orden:terminal-size'
const RESTORE_KEY = 'orden:terminal-restore'
const WARN_KEY = 'orden:terminal-quit-warn'
const WAYS_KEY = 'orden:terminal-keys'
const THEMED_KEY = 'orden:terminal-themed'

export type Way = 'app' | 'shell'

export function waysOf(value: unknown): Record<string, Way> {
  if (!isRecord(value)) return {}

  const ways: Record<string, Way> = {}
  for (const [command, way] of Object.entries(value)) {
    if (way === 'app' || way === 'shell') ways[command] = way
  }
  return ways
}

const WARNINGS = ['always', 'running', 'never'] as const
export type Warning = (typeof WARNINGS)[number]

export function asWarning(value: unknown): Warning {
  return WARNINGS.find((one) => one === value) ?? 'running'
}

export const SIZES = { least: 9, most: 28, initial: 13 } as const

function sizeOf(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number)) return SIZES.initial
  return Math.min(SIZES.most, Math.max(SIZES.least, Math.round(number)))
}

export function shellName(shell: Shell): string {
  return shell.id === 'cmd' ? t('Command Prompt') : shell.name
}

function readShells(value: unknown): Shell[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((one: unknown) => {
    if (typeof one !== 'object' || one === null) return []
    const { id, name } = one as { id?: unknown; name?: unknown }
    return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : []
  })
}

class Shells {
  list = $state.raw<Shell[]>([])
  preferred = $state(storedText(SHELL_KEY) ?? '')
  size = $state(sizeOf(storedText(SIZE_KEY)))
  restoring = $state(storedText(RESTORE_KEY) !== 'no')
  themed = $state(storedText(THEMED_KEY) !== 'no')
  warning = $state<Warning>(asWarning(storedText(WARN_KEY)))
  ways = $state<Record<string, Way>>(waysOf(stored(WAYS_KEY)))

  private asked: Promise<Shell[]> | null = null

  ask(): Promise<Shell[]> {
    if (!isDesktop) return Promise.resolve([])

    this.asked ??= invoke<unknown>('terminal_shells')
      .then((found) => {
        this.list = readShells(found)
        return this.list
      })
      .catch(() => {
        this.asked = null
        return []
      })

    return this.asked
  }

  get chosen(): Shell | undefined {
    return this.list.find((one) => one.id === this.preferred) ?? this.list[0]
  }

  choose(id: string) {
    this.preferred = id
    keep(SHELL_KEY, id)
  }

  setSize(size: number) {
    this.size = sizeOf(String(size))
    keep(SIZE_KEY, String(this.size))
  }

  setWarning(warning: Warning) {
    this.warning = warning
    keep(WARN_KEY, warning)
  }

  setWay(command: string, way: Way | null) {
    this.ways = withOrWithout(this.ways, command, way)
    keepJson(WAYS_KEY, this.ways)
  }

  setThemed(on: boolean) {
    this.themed = on
    keep(THEMED_KEY, on ? 'yes' : 'no')
  }

  setRestoring(on: boolean) {
    this.restoring = on
    keep(RESTORE_KEY, on ? 'yes' : 'no')
    if (!on) void import('./history').then((one) => one.forgetHistories())
  }
}

export const shells = new Shells()
