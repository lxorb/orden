export interface WebPageSeen {
  readonly url: string | null
  readonly title: string
  readonly back: boolean
  readonly forward: boolean
  readonly zoom: number
  readonly shot: string | null
}

export interface WebPagesPort {
  readonly cuts: boolean
  of(tab: string): WebPageSeen
  holdStill(): Promise<void> | null
  letGo(): Promise<void>
  carryIn(paths: readonly string[]): void
  carriedIn(): void
}

export interface WebPorts {
  readonly 'web.pages': WebPagesPort
}

const BLANK: WebPageSeen = {
  url: null,
  title: '',
  back: false,
  forward: false,
  zoom: 1,
  shot: null,
}

export const NO_WEB_PAGES: WebPagesPort = {
  cuts: false,
  of: () => BLANK,
  holdStill: () => null,
  letGo: () => Promise.resolve(),
  carryIn: () => undefined,
  carriedIn: () => undefined,
}
