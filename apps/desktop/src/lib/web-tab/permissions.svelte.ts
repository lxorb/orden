/** What a site in a web tab has been allowed, per site, and nothing until somebody
 *  says so.
 *
 *  A page in a tab is somebody else's code running inside the app's window, so the
 *  answer to every prompt a browser would put on screen is no by default. It is no
 *  by taking the API away rather than by refusing a request, which is what keeps the
 *  engine from asking at all: see `GUARD` in src-tauri/src/web_tabs.rs, which is
 *  handed whatever is granted here when the webview is built.
 *
 *  By origin, because that is what a permission is about - a grant to `docs.example`
 *  is not a grant to every page that links to it - and this device's, because it is
 *  about this machine's camera. So it lives in local storage beside the other things
 *  a device decides for itself, and never on the account.
 *
 *  Changing a grant means building the webview again: the guard runs once, before the
 *  page's first script, and a page already running was built under the old answer.
 *  The store says so by counting, and the tab reopens itself; see pages.svelte.ts. */

import { withOrWithout } from '../records'
import { isRecord, stored, stringList } from '../stored'
import { plainOrigin } from './address'

const STORAGE_KEY = 'nib:web-grants'

/** The two a page has any business asking a notes app for.
 *
 *  The camera stands for the microphone as well: they are one API, `mediaDevices`,
 *  and a page that may see you may hear you. Where you are is not on the list at
 *  all, and neither is anything that reaches hardware over a bus - a note-taking app
 *  has no reason to let a page talk to a USB device, so that is refused outright
 *  rather than offered as a choice. */
export const GRANTS = ['camera', 'clipboard'] as const

export type Grant = (typeof GRANTS)[number]

function isGrant(value: string): value is Grant {
  return GRANTS.some((one) => one === value)
}

/** The origin a grant is about: the host as the bar shows it, so what somebody
 *  allowed reads as the site they were looking at. */
export function siteOf(url: string | null): string {
  return url === null ? '' : plainOrigin(url)
}

class Grants {
  private by = $state<Record<string, Grant[]>>({})

  /** How many times a grant has changed this run. What a tab watches, so a page
   *  built under the old answer is built again under the new one. */
  changed = $state(0)

  constructor() {
    const read = stored(STORAGE_KEY)
    if (!isRecord(read)) return

    const out: Record<string, Grant[]> = {}
    for (const [site, value] of Object.entries(read)) {
      const said = stringList(value)
      if (said) out[site] = said.filter(isGrant)
    }
    this.by = out
  }

  /** What this site has, which is nothing unless it was allowed something. */
  of(site: string): Grant[] {
    return this.by[site] ?? []
  }

  has(site: string, grant: Grant): boolean {
    return this.of(site).includes(grant)
  }

  /** Allows or refuses one thing for one site. A site with nothing left is taken
   *  out, so the store holds the sites somebody has decided about and no others. */
  set(site: string, grant: Grant, on: boolean) {
    if (!site || this.has(site, grant) === on) return

    const kept = this.of(site).filter((one) => one !== grant)
    const next = on ? [...kept, grant] : kept

    // A site with nothing left is taken out, so the store holds the sites somebody
    // has decided about and no others.
    const all = withOrWithout(this.by, site, next.length ? next : null)
    this.by = all
    this.changed++

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // A browser with storage turned off still refuses everything, which is the
      // answer that matters; it just forgets what was allowed.
    }
  }
}

export const grants = new Grants()
