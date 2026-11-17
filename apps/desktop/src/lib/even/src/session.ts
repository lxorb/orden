import { type Page, pageAt, pagesOf, type Paging } from '@orden/glasses'

export interface OpenNote {
  key: string
  name: string
  text: string
}

export interface Showing {
  key: string
  name: string
  page: number
  count: number
  from: number
  to: number
  firstLine: number
  lastLine: number
}

interface Shown {
  key: string
  name: string
  pages: Page[]
  page: number
}

function clamp(page: number, count: number): number {
  return Math.min(Math.max(0, page), Math.max(0, count - 1))
}

export class Session {
  private shown: Shown | null = null
  private readonly places = new Map<string, number>()
  private sent = ''

  get pages(): readonly Page[] {
    return this.shown?.pages ?? []
  }

  get page(): Page | null {
    const shown = this.shown
    return shown?.pages[shown.page] ?? null
  }

  get onPanel(): readonly Page[] {
    return this.panelAt(this.shown?.page ?? 0)
  }

  private panelAt(page: number): readonly Page[] {
    const only = this.shown?.pages[page]
    return only ? [only] : []
  }

  get words(): string {
    return this.onPanel
      .map((one) => one.words)
      .filter((one) => one !== '')
      .join('\n')
  }

  get numbers(): string {
    const shown = this.onPanel.filter((one) => one.words !== '')
    return shown.map((one) => one.numbers).join('\n')
  }

  get showing(): Showing | null {
    return this.showingAt(this.shown?.page ?? 0)
  }

  regionAt(offset: number): Showing | null {
    const shown = this.shown
    if (!shown?.pages.length) return null

    return this.showingAt(clamp(pageAt(shown.pages, offset), shown.pages.length))
  }

  private showingAt(page: number): Showing | null {
    const shown = this.shown
    const panel = this.panelAt(page)
    const first = panel[0]
    const last = panel.at(-1)
    if (!shown || !first || !last) return null

    return {
      key: shown.key,
      name: shown.name,
      page,
      count: Math.max(1, shown.pages.length),
      from: first.from,
      to: last.to,
      firstLine: first.firstLine,
      lastLine: last.lastLine,
    }
  }

  get moved(): boolean {
    return this.stamp !== this.sent
  }

  drew(): void {
    this.sent = this.stamp
  }

  private get stamp(): string {
    return this.onPanel.map((one) => one.hash).join('|')
  }

  follow(open: OpenNote | null, paging: Paging): void {
    if (!open) return

    const before = this.shown
    const pages = pagesOf(open.text, paging)
    if (!pages.length) {
      return
    }

    const was = before?.key === open.key ? before : null
    if (before && !was) this.places.set(before.key, before.page)

    const showed = was?.pages[was.page]
    const still = showed ? pages.find((one) => one.hash === showed.hash) : undefined
    const page = still
      ? still.index
      : showed
        ? pageAt(pages, showed.from)
        : clamp(this.places.get(open.key) ?? 0, pages.length)

    const at = clamp(page, pages.length)
    this.shown = { key: open.key, name: open.name, pages, page: at }
    this.places.set(open.key, at)
  }

  turn(by: number): void {
    const shown = this.shown
    if (!shown) return

    this.goTo(shown.page + by)
  }

  goTo(page: number): void {
    const shown = this.shown
    if (!shown) return

    const at = clamp(page, shown.pages.length)
    shown.page = at
    this.places.set(shown.key, at)
  }

  goToOffset(offset: number): void {
    const shown = this.shown
    if (!shown?.pages.length) return

    this.goTo(pageAt(shown.pages, offset))
  }

  holds(offset: number): boolean {
    const showing = this.showing
    return showing !== null && offset >= showing.from && offset < showing.to
  }
}
