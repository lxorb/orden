import type { TabKind } from './shell'

export interface TabMenuItem {
  readonly label: string
  readonly hint?: string | undefined
  readonly disabled?: boolean
  readonly keep?: boolean
  readonly more?: () => Promise<TabMenuEntry[]>
  readonly run: () => void
}

export type TabMenuEntry = TabMenuItem | null

export interface TabUsage {
  readonly cpu: number
  readonly memory: number
  readonly gpu?: number
}

export interface TabStream {
  readonly width: number | null
  readonly height: number | null
  readonly fps: number | null
  readonly bitrate: number | null
  readonly rtt: number | null
  readonly encoder: string | null
}

export interface TabFacts {
  readonly host: string | null
  readonly usage: TabUsage | null
  readonly stream: TabStream | null
}

export interface OpenHow {
  readonly activate?: boolean
  readonly preview?: boolean
  readonly beside?: boolean
}

interface TabIcon {
  readonly worn: (tab: string) => string | null
  readonly tint: (tab: string) => string | null
  readonly wear: (tab: string, icon: string | null, colour: string | null) => void
}

export interface TabKindParts {
  readonly open?: (path: string, how: OpenHow) => Promise<void>
  readonly make?: (folder?: string, name?: string) => Promise<void>
  readonly menu?: (tab: string) => TabMenuEntry[]
  readonly facts?: (tab: string) => Promise<TabFacts | null>
  readonly hold?: (tab: string) => (() => void) | null
  readonly rename?: (tab: string, name: string) => Promise<void>
  readonly icon?: TabIcon
}

export const NO_TAB_KIND: TabKindParts = {}

const loads = new Map<TabKind, () => Promise<TabKindParts>>()
const loaded = new Map<TabKind, TabKindParts>()

export function registerTabKind(kind: TabKind, load: () => Promise<TabKindParts>): () => void {
  loads.set(kind, load)
  loaded.delete(kind)
  return () => {
    if (loads.get(kind) !== load) return
    loads.delete(kind)
    loaded.delete(kind)
  }
}

export function tabKindParts(kind: TabKind): TabKindParts {
  return loaded.get(kind) ?? NO_TAB_KIND
}

export async function tabKindLoaded(kind: TabKind): Promise<TabKindParts> {
  const load = loads.get(kind)
  if (!load) return NO_TAB_KIND
  const held = loaded.get(kind)
  if (held) return held
  const parts = await load().catch(() => null)
  if (!parts || loads.get(kind) !== load) return NO_TAB_KIND
  loaded.set(kind, parts)
  return parts
}
