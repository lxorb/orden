export interface TimeSpaceSeen {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly icon: string | null
}
export interface TimeTabSeen {
  readonly id: string
  readonly kind: string
  readonly path: string | null
  readonly name: string
  readonly shown: string
  readonly inPrivate: boolean
  readonly address?: string | null | undefined
}
export interface TimeTabHeld {
  readonly doc: string
  readonly note: { replace(text: string, undoable: boolean): void }
}
export type TimeRange =
  { readonly kind: 'day' | 'week' | 'month' } | { readonly kind: 'custom'; readonly from: number; readonly to: number }
export interface TimeSpecSeen {
  readonly range: string
  readonly from: number | null
  readonly to: number | null
  readonly day: number | null
}
export interface TimePlacesPort {
  readonly space: TimeSpaceSeen | null
  readonly tab: TimeTabSeen | null
  readonly spaces: readonly TimeSpaceSeen[]
  readonly tabs: readonly TimeTabSeen[]
}
export interface TimeOpenPort {
  show(spec: string): void
}
export interface TimePorts {
  readonly 'time.places': TimePlacesPort
  readonly 'time.open': TimeOpenPort
}
export const NO_TIME_PLACES: TimePlacesPort = { space: null, tab: null, spaces: [], tabs: [] }
