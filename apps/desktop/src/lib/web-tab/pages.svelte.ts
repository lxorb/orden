/** The page each web tab is on, and the webview drawing it.
 *
 *  A web tab is a pane with a hole in it. On a desktop the page is not in the
 *  document at all: it is a second webview inside the same window, placed over the
 *  rectangle the pane leaves for it, because a frame cannot show most of the web -
 *  the sites worth reading refuse to be framed, and a tab that showed a refusal
 *  where the page should be would not be a tab. So the pane measures itself and this
 *  tells the crate where to put the page; see src-tauri/src/web_tabs.rs.
 *
 *  In a browser and on a phone there is no second webview to place, and the state
 *  here is the same state with nothing behind it: the address, the title the page
 *  reported, and whether it may be framed at all. One store for all three builds, so
 *  the bar above the page is one bar.
 *
 *  Memory is honest about itself. A page nobody has looked at for a few minutes is
 *  taken down and the tab remembers where it was, so a window left open for a day
 *  with eight sites in it is not eight browsers; looking at it again opens it where
 *  it was. */

import { SvelteMap } from 'svelte/reactivity'
import { invoke, isDesktop } from '../tauri'
import { isWebAddress } from './address'
import { grants, type Grant, siteOf } from './permissions.svelte'

/** How long a page goes on running after the tab showing it went away.
 *
 *  Five minutes, which is long enough that switching between two tabs never reloads
 *  and short enough that a window somebody left open overnight is holding nothing.
 *  A page that is taken down keeps its address, so coming back to the tab is a load
 *  and not a loss. */
const ASLEEP_AFTER = 5 * 60 * 1000

/** Where the pane left room for the page, in the window's own pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Which way a step goes, as the crate names them. */
export type Step = 'back' | 'forward' | 'reload'

/** What a browser build is showing in the pane: the card that stands for the page,
 *  or the frame the reader asked for. A desktop has neither - the page is a webview
 *  of its own; see frame.ts for why a browser is asked at all. */
export type Framing = 'card' | 'frame'

/** What the crate says when a page moves. Read rather than trusted: an event is a
 *  boundary like any other. */
interface Moved {
  tab: string
  url: string
  title: string
  back: boolean
  forward: boolean
  loading: boolean
}

function readMoved(value: unknown): Moved | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  if (typeof said.tab !== 'string' || typeof said.url !== 'string') return null

  return {
    tab: said.tab,
    url: said.url,
    title: typeof said.title === 'string' ? said.title : '',
    back: said.back === true,
    forward: said.forward === true,
    loading: said.loading === true,
  }
}

/** One web tab's page. */
export class Page {
  /** Where the page is. The tab's own address until the page says otherwise, so a
   *  tab restored from a session knows where it is going before it gets there. */
  url = $state<string | null>(null)
  /** What the page calls itself, or the empty string before it has said. */
  title = $state('')
  back = $state(false)
  forward = $state(false)
  loading = $state(false)
  /** What went wrong, for the one row that says so. */
  fault = $state<string | null>(null)
  /** What a browser build has in the pane. The card until the reader presses it,
   *  and the frame from then on: one press per tab, because saying yes to a site is
   *  about the tab rather than about each page in it. Never read on a desktop. */
  framing = $state<Framing>('card')

  /** Whether there is a webview behind this tab at the moment. */
  live = $state(false)

  /** The grant count the live webview was built under, so a change to what this
   *  site may do is a page built again rather than a page that quietly kept the old
   *  answer. */
  builtAt = 0

  /** Set while the address field is being typed in, so the page reporting a new
   *  title does not rewrite what somebody is halfway through typing. */
  typing = $state(false)

  asleep: ReturnType<typeof setTimeout> | undefined
}

class Pages {
  private readonly held = new SvelteMap<string, Page>()

  /** Started once, on the first web tab, and never taken down: the window hears
   *  about every page in it through one listener. */
  private listening = false

  /** The state for a tab, made the first time it is asked for. */
  of(tabId: string): Page {
    const found = this.held.get(tabId)
    if (found) return found

    const made = new Page()
    this.held.set(tabId, made)
    return made
  }

  /** What the tab is pointing at, for the session and for the bar. */
  addressOf(tabId: string): string | null {
    return this.held.get(tabId)?.url ?? null
  }

  /** Puts the page on screen where the pane says, opening it if it is not there.
   *
   *  One call for the whole of "this tab is showing, and this is its rectangle",
   *  because that is one fact: the pane says it on every resize and on every scroll,
   *  and a page that had to be opened, then placed, then shown would flash where the
   *  last one was. */
  async show(tabId: string, url: string, pane: Rect): Promise<void> {
    const page = this.of(tabId)
    this.wake(page)
    page.url ??= url

    if (!isDesktop) {
      page.live = true
      return
    }

    await this.listen()

    const site = siteOf(page.url)
    const stale = page.live && page.builtAt !== grants.changed
    if (stale) await this.sleep(tabId)

    if (!page.live) {
      page.builtAt = grants.changed
      const granted: Grant[] = grants.of(site)
      try {
        await invoke('web_open', { tab: tabId, url: page.url, pane, granted })
        page.live = true
        page.fault = null
      } catch (error) {
        page.fault = String(error)
      }
      return
    }

    await this.place(tabId, pane, true)
  }

  /** Where the page sits, and whether it is on screen at all. A tab that is not the
   *  one showing hides its page rather than closing it: coming back to a tab should
   *  not be a reload. */
  async place(tabId: string, pane: Rect, visible: boolean): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return

    try {
      await invoke('web_place', { tab: tabId, pane, visible })
    } catch {
      // The webview has gone - the window closed under it, or the page was taken
      // down while this was in the air. The next show opens it again.
      page.live = false
    }
  }

  /** The tab is no longer the one on top: the page goes out of sight and starts
   *  counting down to being taken down altogether. */
  hide(tabId: string, pane: Rect) {
    const page = this.held.get(tabId)
    if (!page) return

    void this.place(tabId, pane, false)

    clearTimeout(page.asleep)
    if (!isDesktop) return

    page.asleep = setTimeout(() => void this.sleep(tabId), ASLEEP_AFTER)
  }

  /** Takes the page down but keeps the tab: what a window left open all day costs
   *  after a few minutes of nobody looking. The address stays, so the tab opens
   *  where it was. */
  async sleep(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (!page?.live) return

    page.live = false
    page.loading = false
    await invoke('web_close', { tab: tabId }).catch(() => undefined)
  }

  private wake(page: Page) {
    clearTimeout(page.asleep)
    page.asleep = undefined
  }

  /** Somewhere else, in this tab. */
  async go(tabId: string, url: string): Promise<void> {
    const page = this.of(tabId)
    if (!isWebAddress(url)) return

    page.url = url
    page.fault = null
    // The title belonged to the page that was there. Until the new one says what it
    // is called the bar shows the site, which is true of both.
    page.title = ''

    // A browser build shows the page in whatever the pane already holds: a frame is
    // told where to go by its `src`, which the component watches `url` for, and a
    // card that has not been pressed stays a card.
    if (!isDesktop) return

    if (!page.live) return

    try {
      await invoke('web_navigate', { tab: tabId, url })
    } catch (error) {
      page.fault = String(error)
    }
  }

  /** Back, forward, or the same page again. The same keys a note tab steps its own
   *  trail with; see `workspace.goBack`. */
  async step(tabId: string, step: Step): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return

    await invoke('web_step', { tab: tabId, step }).catch((error: unknown) => {
      page.fault = String(error)
    })
  }

  /** The page, read for a clip: where it is, what it is called, and the HTML of the
   *  part worth keeping. Null where there is nothing to read, which is a browser
   *  build - a frame's document belongs to the site and not to us. */
  async read(
    tabId: string,
    selection: boolean,
  ): Promise<{ url: string; title: string; html: string } | null> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return null

    try {
      return await invoke<{ url: string; title: string; html: string }>('web_clip', {
        tab: tabId,
        selection,
      })
    } catch (error) {
      page.fault = String(error)
      return null
    }
  }

  /** The tab has closed. Nothing is kept: the webview goes with it. */
  forget(tabId: string) {
    const page = this.held.get(tabId)
    if (!page) return

    clearTimeout(page.asleep)
    this.held.delete(tabId)
    if (isDesktop) void invoke('web_close', { tab: tabId }).catch(() => undefined)
  }

  /** Every page whose tab has gone, closed.
   *
   *  For the one way tabs disappear without being closed one at a time: an
   *  arrangement put in place over the top of them - a saved layout, a session, a
   *  window becoming a phone. A webview nothing is left to place is a browser
   *  running behind an app with nowhere to draw it. */
  keepOnly(ids: readonly string[]) {
    const kept = new Set(ids)
    for (const tabId of [...this.held.keys()]) {
      if (!kept.has(tabId)) this.forget(tabId)
    }
  }

  /** One listener for the window, started by the first web tab that needs it. */
  private async listen(): Promise<void> {
    if (this.listening || !isDesktop) return
    this.listening = true

    const { listen } = await import('@tauri-apps/api/event')
    await listen('nib://web-tab', (event) => {
      const said = readMoved(event.payload)
      if (!said) return

      const page = this.held.get(said.tab)
      if (!page) return

      page.loading = said.loading
      page.back = said.back
      page.forward = said.forward
      if (said.url && !page.typing) page.url = said.url
      if (said.title) page.title = said.title
    })
  }
}

export const pages = new Pages()
