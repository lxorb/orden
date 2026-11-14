import { without, invoke } from '../platform/src/api'
import type { Provider, ProviderKind } from './providers'

export interface Weekly {
  used: number
  resets: number | null
}

const WEEK_MINUTES = 7 * 24 * 60

const AGAIN = 5 * 60_000

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function percent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

function moment(value: unknown, seconds: boolean): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return seconds ? value * 1000 : value
  if (typeof value !== 'string') return null
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : at
}

function claudeWeek(said: Record<string, unknown> | null): Weekly | null {
  const week = record(record(said?.rate_limits)?.seven_day)
  const used = percent(week?.utilization)
  return used === null ? null : { used, resets: moment(week?.resets_at, true) }
}

function codexWeek(said: Record<string, unknown> | null): Weekly | null {
  const limits = record(said?.rateLimits)
  const windows = [record(limits?.primary), record(limits?.secondary)].filter(
    (one): one is Record<string, unknown> => percent(one?.usedPercent) !== null,
  )
  const week =
    windows.find((one) => one.windowDurationMins === WEEK_MINUTES) ??
    windows.find(
      (one) =>
        typeof one.windowDurationMins === 'number' && one.windowDurationMins > WEEK_MINUTES / 2,
    )
  if (!week) return null
  return { used: percent(week.usedPercent) ?? 0, resets: moment(week.resetsAt, true) }
}

export function weeklyIn(kind: ProviderKind, said: unknown): Weekly | null {
  if (kind === 'claude-code') return claudeWeek(record(said))
  if (kind === 'codex') return codexWeek(record(said))
  return null
}

function measured(kind: ProviderKind): boolean {
  return kind === 'claude-code' || kind === 'codex'
}

class Usage {
  weeks = $state<Record<string, Weekly | null>>({})

  private asked = new Map<string, number>()

  of(id: string): Weekly | null {
    return this.weeks[id] ?? null
  }

  async look(account: Pick<Provider, 'id' | 'kind'>, force = false): Promise<void> {
    if (__EVEN_PLUGIN__ || !measured(account.kind)) return
    const last = this.asked.get(account.id)
    if (!force && last !== undefined && Date.now() - last < AGAIN) return
    this.asked.set(account.id, Date.now())
    const said = await invoke<unknown>('ai_cli_usage', {
      tool: account.kind,
      account: account.id,
    }).catch(() => undefined)
    if (said === undefined) return
    this.weeks = { ...this.weeks, [account.id]: weeklyIn(account.kind, said) }
  }

  forget(id: string): void {
    this.asked.delete(id)
    this.weeks = without(this.weeks, id)
  }
}

export const usage = /* @__PURE__ */ new Usage()

export const USAGE_EVERY = AGAIN
