import { isRecord, spaceHolding } from '../../platform/src/api'
import { type Frame, paneIn, panesIn, withoutPane } from '../../panes/src/api'
import { isPanel, type Layout, readLayout, type Panel } from '../../session/src/api'

export const GLOBAL = 'global'
export function setKey(space: string | null): string {
  return space ?? GLOBAL
}
export function sharedGoesTo(
  spaces: readonly string[],
  owned: ReadonlySet<string>,
  hasSet: (space: string) => boolean,
): string | null {
  return spaces.find((one) => !owned.has(one) && !hasSet(one)) ?? null
}
export type HiddenTabs = 'run' | 'pause' | 'ask'
export function isHiddenTabs(value: unknown): value is HiddenTabs {
  return value === 'run' || value === 'pause' || value === 'ask'
}
export function onLeaving(choice: HiddenTabs, running: number): HiddenTabs {
  return running > 0 ? choice : 'run'
}
export function ownerOf(
  path: string | null,
  home: string | null,
  spaces: readonly { id: string; root: string }[],
): string | null {
  if (path === null) return home
  return spaceHolding(spaces, path)?.id ?? null
}
export function tidied(
  frame: Frame,
  strip: (paneId: string) => readonly string[],
  next: (strip: readonly string[]) => string | null,
): Frame {
  let out = frame
  for (const one of panesIn(frame)) {
    if (!strip(one.id).length && panesIn(out).length > 1) out = withoutPane(out, one.id)
  }
  for (const one of panesIn(out)) {
    const tabs = strip(one.id)
    if (one.activeTabId === null ? tabs.length > 0 : tabs.includes(one.activeTabId)) continue
    one.activeTabId = next(tabs)
  }
  return out
}
export function focusIn(frame: Frame, focused: string): string {
  return paneIn(frame, focused) ? focused : (panesIn(frame)[0]?.id ?? focused)
}
export interface SetDraft {
  layout: Layout
  right: Panel | null
}
export interface SetsDraft {
  on: string
  aside: Record<string, SetDraft>
}
export function readSets(value: unknown): SetsDraft | null {
  if (!isRecord(value) || typeof value.on !== 'string' || !isRecord(value.aside)) return null
  const aside: Record<string, SetDraft> = {}
  for (const [key, one] of Object.entries(value.aside)) {
    if (!isRecord(one)) continue
    const layout = readLayout(one.layout)
    if (layout) aside[key] = { layout, right: isPanel(one.right) ? one.right : null }
  }
  return { on: value.on, aside }
}
