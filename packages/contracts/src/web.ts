export interface WebPageSeen {
  readonly url: string | null
  readonly title: string
  readonly back: boolean
  readonly forward: boolean
  readonly zoom: number
  readonly shot: string | null
  readonly loading: boolean
  readonly icon: string | null
}

export interface PressedKey {
  readonly key: string
  readonly code: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly repeat: boolean
  readonly down: boolean
}

export type OfferedEngine = { readonly id: string } | { readonly custom: string }

export type EngineTaken = 'same' | 'taken' | 'kept'

export interface WebClip {
  readonly url: string
  readonly title: string
  readonly html: string
}

export interface WebPagesPort {
  readonly cuts: boolean
  of(tab: string): WebPageSeen
  tabs(): readonly string[]
  addressOf(tab: string): string | null
  loadingOf(tab: string): boolean
  shoot(tab: string): Promise<void>
  clip(tab: string, selection: boolean): Promise<WebClip | null>
  faviconOf(url: string | null | undefined): string | null
  holdStill(): Promise<void> | null
  letGo(): Promise<void>
  carryIn(paths: readonly string[]): void
  carriedIn(): void
  bringHistory(rows: readonly unknown[]): Promise<void>
  takeEngine(engine: OfferedEngine): Promise<EngineTaken>
  replayKey(key: PressedKey): void
}

export interface WebLendingPort {
  adopt(tab: string, handing: () => Promise<void>): Promise<void>
  unlend(tab: string): void
}

export interface WebPorts {
  readonly 'web.pages': WebPagesPort
  readonly 'web.lending': WebLendingPort
}

const BLANK: WebPageSeen = {
  url: null,
  title: '',
  back: false,
  forward: false,
  zoom: 1,
  shot: null,
  loading: false,
  icon: null,
}

export const NO_WEB_PAGES: WebPagesPort = {
  cuts: false,
  of: () => BLANK,
  tabs: () => [],
  addressOf: () => null,
  loadingOf: () => false,
  shoot: () => Promise.resolve(),
  clip: () => Promise.resolve(null),
  faviconOf: () => null,
  holdStill: () => null,
  letGo: () => Promise.resolve(),
  carryIn: () => undefined,
  carriedIn: () => undefined,
  bringHistory: () => Promise.resolve(),
  takeEngine: () => Promise.resolve('same'),
  replayKey: () => undefined,
}
