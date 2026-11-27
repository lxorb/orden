import type { TimeRange, TimeSpecSeen } from '@orden/contracts'
import type { Component, Snippet } from 'svelte'
import { midnightOf } from '../../platform/src/api'

export type Screen = 'now' | 'day' | 'stats'
export const WIDE = 600
export interface TrackParts {
  readonly Now: Component<{ now: number; onday: (at?: number) => void }>
  readonly Day: Component<{
    now: number
    day: number
    only?: string | null
    onday: (day: number) => void
    onall: () => void
    onmanage: () => void
  }>
  readonly Stats: Component<{
    now: number
    range: TimeRange
    onrange: (range: TimeRange) => void
    onpick: (activity: string | null, day: number) => void
  }>
  readonly Activities: Component<{ open: boolean; onclose: () => void }>
  readonly BottomSheet: Component<{ open: boolean; label: string; onclose: () => void; children: Snippet }>
  readonly reminders: { readonly on: boolean; set(on: boolean): void }
  ticking(): { readonly now: number }
  readSpec(text: string): TimeSpecSeen
  undone(redo: boolean): boolean
}
export interface Shown {
  readonly screen: Screen
  readonly only: string | null
  readonly settings: boolean
  readonly activities: boolean
}
export function backOf(shown: Shown): Partial<Shown> | null {
  if (shown.activities) return { activities: false }
  if (shown.settings) return { settings: false }
  if (shown.only !== null) return { only: null }
  if (shown.screen !== 'now') return { screen: 'now' }
  return null
}
export function specOf(spec: TimeSpecSeen): { screen: Screen; day: number | null; range: TimeRange | null } {
  if (spec.day !== null) return { screen: 'day', day: midnightOf(spec.day), range: null }
  if (spec.range === 'custom' && spec.from !== null && spec.to !== null)
    return {
      screen: 'stats',
      day: null,
      range: { kind: 'custom', from: midnightOf(spec.from), to: midnightOf(spec.to) },
    }
  if (spec.range === 'week' || spec.range === 'month')
    return { screen: 'stats', day: null, range: { kind: spec.range } }
  return { screen: 'day', day: null, range: null }
}
export class TrackNav {
  screen = $state<Screen>('now')
  day = $state(midnightOf(Date.now()))
  only = $state<string | null>(null)
  range = $state<TimeRange>({ kind: 'day' })
  settings = $state(false)
  activities = $state(false)
  get deep(): boolean {
    return backOf(this) !== null
  }
  show(screen: Screen) {
    this.screen = screen
    this.only = null
  }
  showDay(day: number, only: string | null = null) {
    this.day = midnightOf(day)
    this.only = only
    this.screen = 'day'
  }
  back(): boolean {
    const step = backOf(this)
    if (!step) return false
    Object.assign(this, step)
    return true
  }
  open(spec: TimeSpecSeen) {
    const to = specOf(spec)
    if (to.range) this.range = to.range
    if (to.screen === 'day') this.showDay(to.day ?? Date.now())
    else this.show(to.screen)
  }
}
