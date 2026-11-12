import type { Space } from '../workspace.svelte'
import { arcSidebar } from './arc'
import { bringHistory, droppedLine, folderWords, takeEngine, withMarks } from './browser-extras'
import { BROWSER_NAMES, browserFile, type BrowserId, type BrowserProfile } from './browsers'
import { chromiumSidebar } from './chromium'
import { firefoxSidebar } from './firefox'
import { unmozLz4 } from './mozlz4'
import { type BrowserEngine, chromiumEngine, mozillaEngine, safariEngine } from './search-engines'
import type { Sidebar } from './sidebar'
import { landSpaces } from './sidebar-landing'
import { sidebarImport } from './sidebar-plan'
import { safariSidebar } from './safari'
import { readSnss, type SnssSession } from './snss'
import { invoke } from '../tauri'

interface Read {
  sidebar: Sidebar
  engine: BrowserEngine | null
  lost: string[]
}

const CONTAINERS = 'Containers stay in Firefox'

const SAVED = (browser: string) => `Saved tab groups and the reading list stay in ${browser}`
const WORKSPACES = (browser: string) => `${browser}’s workspaces come in as one space`
const KEPT: Partial<Record<BrowserId, (browser: string) => string>> = {
  chrome: SAVED,
  chromium: SAVED,
  brave: SAVED,
  edge: () => 'Workspaces and collections stay in Edge',
  vivaldi: WORKSPACES,
  opera: WORKSPACES,
  'opera-gx': WORKSPACES,
}

export async function landBrowser(profile: BrowserProfile, several: boolean): Promise<Space> {
  const browser = BROWSER_NAMES[profile.browser]
  const name = several ? `${browser} (${profile.name})` : browser
  const firefox = profile.browser === 'firefox'
  const nothing = `Nothing could be read out of ${browser}.`
  const read = await readProfile(profile, name)
  if (!read) throw new Error(nothing)

  const sidebar = await withMarks(read.sidebar, profile.browser, profile.path)
  const { spaces, lost } = sidebarImport(sidebar, new Date(), firefox ? CONTAINERS : null)
  const kept = KEPT[profile.browser]
  const lines = [
    ...lost,
    ...read.lost,
    ...droppedLine(sidebar),
    ...(kept ? [kept(browser)] : []),
    ...(await takeEngine(read.engine, browser)),
  ]
  const first = await landSpaces(spaces, lines, nothing)
  await bringHistory(profile.browser, profile.path)
  return first
}

async function readProfile(profile: BrowserProfile, name: string): Promise<Read | null> {
  if (profile.browser === 'safari') return readSafari(name)
  if (profile.browser === 'firefox') return readFirefox(profile, name)
  if (profile.browser === 'arc') return (await readArc(profile)) ?? readChromium(profile, name)
  return readChromium(profile, name)
}

const SEARCH = 'search.json.mozlz4'

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

const BOOKMARK_FILES = ['Bookmarks', 'AccountBookmarks']

function isSession(file: string): boolean {
  return file.startsWith('Sessions') || file === 'Current Session' || file === 'Last Session'
}

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
  const lost =
    !session && locked
      ? [
          `${BROWSER_NAMES[profile.browser]} keeps its open tabs locked, so only its bookmarks came.`,
        ]
      : []
  return {
    sidebar: chromiumSidebar(session, bookmarks, name, folderWords(), account),
    engine: await preferencesEngine(profile),
    lost,
  }
}

async function readArc(profile: BrowserProfile): Promise<Read | null> {
  const said = await invoke<string>('read_arc_sidebar', { profile: profile.path })
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null)
  const arc = arcSidebar(said, profile.path.split(/[\\/]/).pop() ?? 'Default')
  if (!arc) return null

  const lost = arc.stayed ? ['Easels and notes stay in Arc'] : []
  return { sidebar: arc.sidebar, engine: await preferencesEngine(profile), lost }
}

async function preferencesEngine(profile: BrowserProfile): Promise<BrowserEngine | null> {
  if (!profile.files.includes('Preferences')) return null
  return chromiumEngine(jsonOf(await browserFile(profile, 'Preferences')))
}

function jsonOf(bytes: Uint8Array | null): unknown {
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return null
  }
}

const NO_ACCESS = 'no access'

async function readSafari(name: string): Promise<Read | null> {
  let said: string
  try {
    said = await invoke<string>('read_safari')
  } catch (error) {
    if (error === NO_ACCESS || (error instanceof Error && error.message === NO_ACCESS)) {
      await invoke('open_full_disk_access').catch(() => undefined)
      throw new Error(
        'macOS keeps Safari’s tabs and bookmarks behind Full Disk Access. Turn Orden on there, then ask again.',
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

function mozJson(bytes: Uint8Array | null): unknown {
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(unmozLz4(bytes))) as unknown
  } catch {
    return null
  }
}
