/** A browser's profile brought in as a space of its own: its open tabs, its pinned ones
 *  as the Essentials, its tab groups as folders and its bookmarks in a folder of their
 *  own, read by the browser's reader and written the way Zen's spaces are
 *  (sidebar-plan.ts, sidebar-landing.ts) - Arc's spaces as spaces, as Zen's are
 *  (arc.ts). Its sites' marks, its history and its search engine come along
 *  (browser-extras.ts). Importing again brings only what is new.
 *
 *  The space is named for the browser, and for the profile too where the browser keeps
 *  several, so two profiles are two spaces and a profile imported twice is one. What
 *  the browser keeps that has nowhere to go here is said in a line. */

import { key, t } from '../i18n.svelte'
import type { Space } from '../workspace.svelte'
import { arcSidebar } from './arc'
import { bringHistory, droppedLine, folderWords, takeEngine, withMarks } from './browser-extras'
import { BROWSER_NAMES, browserFile, type BrowserId, type BrowserProfile } from './browsers'
import { chromiumSidebar } from './chromium'
import { firefoxSidebar } from './firefox'
import { unmozLz4 } from './mozlz4'
import type { Lost } from './plan'
import { type BrowserEngine, chromiumEngine, mozillaEngine, safariEngine } from './search-engines'
import type { Sidebar } from './sidebar'
import { landSpaces } from './sidebar-landing'
import { sidebarImport } from './sidebar-plan'
import { safariSidebar } from './safari'
import { readSnss, type SnssSession } from './snss'
import { invoke } from '../tauri'

/** What a browser's profile came to: its sidebar, its search engine, and what could not
 *  come with it. */
interface Read {
  sidebar: Sidebar
  engine: BrowserEngine | null
  lost: Lost[]
}

/** Only Firefox has containers to leave behind. */
const CONTAINERS: Lost = { text: key('Containers stay in Firefox') }

/** What a Chromium keeps that its files here do not hold, or that has nowhere to go:
 *  the tab groups it saved and its reading list are in its sync database, a workspace
 *  of Vivaldi's or Opera's is a list of tabs that come anyway, and Edge keeps its
 *  workspaces and collections with its account. */
const SAVED: Lost = { text: key('Saved tab groups and the reading list stay in {browser}') }
const WORKSPACES: Lost = { text: key('{browser}’s workspaces come in as one space') }
const KEPT: Partial<Record<BrowserId, Lost>> = {
  chrome: SAVED,
  chromium: SAVED,
  brave: SAVED,
  edge: { text: key('Workspaces and collections stay in Edge') },
  vivaldi: WORKSPACES,
  opera: WORKSPACES,
  'opera-gx': WORKSPACES,
}

/** The profile written into its space; `several` where the browser keeps more than
 *  one profile. Answers the space, to land in. */
export async function landBrowser(profile: BrowserProfile, several: boolean): Promise<Space> {
  const browser = BROWSER_NAMES[profile.browser]
  const name = several ? `${browser} · ${profile.name}` : browser
  const firefox = profile.browser === 'firefox'
  const nothing = t('Nothing could be read out of {browser}.', { browser })
  const read = await readProfile(profile, name)
  if (!read) throw new Error(nothing)

  const sidebar = await withMarks(read.sidebar, profile.browser, profile.path)
  const { spaces, lost } = sidebarImport(sidebar, new Date(), firefox ? CONTAINERS : null)
  const kept = KEPT[profile.browser]
  const lines = [
    ...lost,
    ...read.lost,
    ...droppedLine(sidebar),
    ...(kept ? [{ ...kept, values: { browser } }] : []),
    ...(await takeEngine(read.engine, browser)),
  ]
  const first = await landSpaces(spaces, lines, nothing)
  await bringHistory(profile.browser, profile.path)
  return first
}

/** The profile read by its browser's reader. */
async function readProfile(profile: BrowserProfile, name: string): Promise<Read | null> {
  if (profile.browser === 'safari') return readSafari(name)
  if (profile.browser === 'firefox') return readFirefox(profile, name)
  if (profile.browser === 'arc') return (await readArc(profile)) ?? readChromium(profile, name)
  return readChromium(profile, name)
}

/** Firefox's search engines. */
const SEARCH = 'search.json.mozlz4'

/** Firefox's session, the first of its files that reads, and its bookmarks: out of
 *  `places.sqlite` where the crate could copy it, else its newest daily copy. Null
 *  where neither is there. */
async function readFirefox(profile: BrowserProfile, name: string): Promise<Read | null> {
  let session: unknown = null
  for (const file of profile.files.filter((one) => one.includes('sessionstore'))) {
    session = mozJson(await browserFile(profile, file))
    if (session) break
  }

  let bookmarks: unknown = null
  if (profile.files.includes('places.sqlite')) {
    bookmarks = await invoke<string>('read_firefox_places', { profile: profile.path })
      .then((said) => JSON.parse(said) as unknown)
      .catch(() => null)
  }
  const backup = profile.files.find((one) => one.startsWith('bookmarkbackups/'))
  if (!bookmarks && backup) bookmarks = mozJson(await browserFile(profile, backup))

  if (!session && !bookmarks) return null
  const engine = profile.files.includes(SEARCH)
    ? mozillaEngine(mozJson(await browserFile(profile, SEARCH)))
    : null
  return { sidebar: firefoxSidebar(session, bookmarks, name, folderWords()), engine, lost: [] }
}

/** A Chromium's bookmark files: its own, and its Google account's. */
const BOOKMARK_FILES = ['Bookmarks', 'AccountBookmarks']

/** A Chromium's session files: the newest first, an older Chromium's two after them. */
function isSession(file: string): boolean {
  return file.startsWith('Sessions') || file === 'Current Session' || file === 'Last Session'
}

/** A Chromium's session, the first of its files that reads, and its bookmarks and its
 *  account's. A session written encrypted is said in a line, and the bookmarks come
 *  alone. Null where none of them is there. */
async function readChromium(profile: BrowserProfile, name: string): Promise<Read | null> {
  let session: SnssSession | null = null
  let locked = false
  for (const file of profile.files.filter(isSession)) {
    const bytes = await browserFile(profile, file)
    const read = bytes ? readSnss(bytes) : null
    if (read === 'locked') locked = true
    else if (read) {
      session = read
      break
    }
  }

  const [bookmarks, account] = await Promise.all(
    BOOKMARK_FILES.map(async (file) =>
      profile.files.includes(file) ? jsonOf(await browserFile(profile, file)) : null,
    ),
  )

  if (!session && !bookmarks && !account) return null
  const lost: Lost[] =
    !session && locked
      ? [
          {
            text: key('{browser} keeps its open tabs locked, so only its bookmarks came.'),
            values: { browser: BROWSER_NAMES[profile.browser] },
          },
        ]
      : []
  return {
    sidebar: chromiumSidebar(session, bookmarks, name, folderWords(), account),
    engine: await preferencesEngine(profile),
    lost,
  }
}

/** Arc's spaces and Favorites out of its sidebar, the profile's own; null where Arc keeps
 *  no sidebar for it, and then its files are read as any Chromium's are. */
async function readArc(profile: BrowserProfile): Promise<Read | null> {
  const said = await invoke<string>('read_arc_sidebar', { profile: profile.path })
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null)
  const arc = arcSidebar(said, profile.path.split(/[\\/]/).pop() ?? 'Default')
  if (!arc) return null

  const lost: Lost[] = arc.stayed ? [{ text: key('Easels and notes stay in Arc') }] : []
  return { sidebar: arc.sidebar, engine: await preferencesEngine(profile), lost }
}

/** A Chromium's search engine, out of its `Preferences`. */
async function preferencesEngine(profile: BrowserProfile): Promise<BrowserEngine | null> {
  if (!profile.files.includes('Preferences')) return null
  return chromiumEngine(jsonOf(await browserFile(profile, 'Preferences')))
}

/** What a JSON file holds, or null for one that is not whole: a file Chromium was
 *  halfway through writing is no bookmarks rather than a refusal. */
function jsonOf(bytes: Uint8Array | null): unknown {
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return null
  }
}

/** What the crate answers when macOS would not let Safari's files be read. */
const NO_ACCESS = 'no access'

/** Safari's tabs, bookmarks and Reading List, read whole by the crate, and the name of
 *  its search engine. Where macOS keeps them behind Full Disk Access, the setting is
 *  opened and the reason said: a line naming a permission and leaving the reader to
 *  find it asks twice. */
async function readSafari(name: string): Promise<Read | null> {
  let said: string
  try {
    said = await invoke<string>('read_safari')
  } catch (error) {
    if (error === NO_ACCESS || (error instanceof Error && error.message === NO_ACCESS)) {
      await invoke('open_full_disk_access').catch(() => undefined)
      throw new Error(
        t(
          'macOS keeps Safari’s tabs and bookmarks behind Full Disk Access. Turn Orden on there, then ask again.',
        ),
        { cause: error },
      )
    }
    return null
  }
  const files = JSON.parse(said) as {
    bookmarks?: unknown
    tabs?: unknown
    session?: unknown
    engine?: unknown
  }
  return {
    sidebar: safariSidebar(
      {
        bookmarks: files.bookmarks ?? null,
        tabs: files.tabs ?? null,
        session: files.session ?? null,
      },
      name,
      folderWords(),
    ),
    engine: safariEngine(files.engine),
    lost: [],
  }
}

/** What a `.jsonlz4` holds, or null for one that is not whole. */
function mozJson(bytes: Uint8Array | null): unknown {
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(unmozLz4(bytes))) as unknown
  } catch {
    return null
  }
}
