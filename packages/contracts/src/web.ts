export interface WebPageSeen {
  readonly url: string | null
  readonly title: string
  readonly kept: string | null
  readonly back: boolean
  readonly forward: boolean
  readonly zoom: number
  readonly shot: string | null
  readonly loading: boolean
  readonly icon: string | null
  readonly live: boolean
  readonly shown: boolean
  readonly playing: boolean
  readonly muted: boolean
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
  lentOf(tab: string): boolean
  losing(tab: string): Promise<boolean>
  reload(tab: string): Promise<void>
  park(tab: string, hidden: boolean): Promise<void>
  copyPage(from: string, to: string, url: string | null, inPrivate: boolean): void
  named(tab: string, url: string | null, title: string): void
  privately(tab: string, inPrivate: boolean): void
  typedInto(tab: string): boolean
  step(tab: string, way: 'back' | 'forward' | 'reload' | 'fresh'): Promise<void>
  stepAddress(tab: string, by: -1 | 1): Promise<string | null>
  freeze(tab: string): void
  thaw(tab: string): Promise<void>
  forget(tab: string): void
  keepOnly(tabs: readonly string[]): void
  shoot(tab: string): Promise<void>
  clip(tab: string, selection: boolean): Promise<WebClip | null>
  faviconOf(url: string | null | undefined): string | null
  holdStill(): Promise<void> | null
  letGo(): Promise<void>
  carryIn(paths: readonly string[]): void
  carriedIn(): void
  bringHistory(rows: readonly unknown[]): Promise<void>
  takeEngine(engine: OfferedEngine): Promise<EngineTaken>
  searchHome(): Promise<string | null>
  replayKey(key: PressedKey): void
  articleOf(page: WebClip): Promise<string>
  clipNote(page: WebClip, on: Date): Promise<string>
}

export interface WebLent {
  readonly url: string | null
  readonly space: string | null
  readonly path: string | null
  readonly own: string | null
}

export interface WebLendingPort {
  adopt(tab: string, handing: () => Promise<void>): Promise<void>
  lend(tab: string, as: WebLent): Promise<void>
  unlend(tab: string): void
  readerStore(): Promise<string | null>
}

export interface WebScriptsPort {
  readonly pages: unknown
}

export interface SiteIcon {
  readonly site: string
  readonly label: string
  readonly picture: string | null
}

export interface SiteIconsHeld {
  readonly lacking: boolean
  readonly list: readonly SiteIcon[]
  picture(site: string): string | null
  refresh(): Promise<void>
}

export interface SiteIconsPort {
  held(): Promise<SiteIconsHeld>
}

export interface WebPorts {
  readonly 'web.pages': WebPagesPort
  readonly 'web.lending': WebLendingPort
  readonly 'web.scripts': WebScriptsPort
  readonly 'web.siteIcons': SiteIconsPort
}

const BLANK: WebPageSeen = {
  url: null,
  title: '',
  kept: null,
  back: false,
  forward: false,
  zoom: 1,
  shot: null,
  loading: false,
  icon: null,
  live: false,
  shown: false,
  playing: false,
  muted: false,
}

export const NO_WEB_PAGES: WebPagesPort = {
  cuts: false,
  of: () => BLANK,
  tabs: () => [],
  addressOf: () => null,
  loadingOf: () => false,
  lentOf: () => false,
  losing: () => Promise.resolve(false),
  reload: () => Promise.resolve(),
  park: () => Promise.resolve(),
  copyPage: () => undefined,
  named: () => undefined,
  privately: () => undefined,
  typedInto: () => false,
  step: () => Promise.resolve(),
  stepAddress: () => Promise.resolve(null),
  freeze: () => undefined,
  thaw: () => Promise.resolve(),
  forget: () => undefined,
  keepOnly: () => undefined,
  shoot: () => Promise.resolve(),
  clip: () => Promise.resolve(null),
  faviconOf: () => null,
  holdStill: () => null,
  letGo: () => Promise.resolve(),
  carryIn: () => undefined,
  carriedIn: () => undefined,
  bringHistory: () => Promise.resolve(),
  takeEngine: () => Promise.resolve('same'),
  searchHome: () => Promise.resolve(null),
  replayKey: () => undefined,
  articleOf: () => Promise.resolve(''),
  clipNote: () => Promise.resolve(''),
}
