/** A browser's profile brought in as a space of its own: its open tabs, its pinned ones
 *  as the Essentials, its tab groups as folders and its bookmarks in a folder of their
 *  own, read by the browser's reader and written the way Zen's spaces are
 *  (sidebar-plan.ts, sidebar-landing.ts). Importing again brings only what is new.
 *
 *  The space is named for the browser, and for the profile too where the browser keeps
 *  several, so two profiles are two spaces and a profile imported twice is one. */

import { key, t } from '../i18n.svelte'
import type { Space } from '../workspace.svelte'
import { BROWSER_NAMES, browserFile, type BrowserProfile } from './browsers'
import { chromiumSidebar } from './chromium'
import { firefoxSidebar } from './firefox'
import type { FolderWords } from './sidebar-made'
import { unmozLz4 } from './mozlz4'
import type { Lost } from './plan'
import type { Sidebar } from './sidebar'
import { landSpaces } from './sidebar-landing'
import { sidebarImport } from './sidebar-plan'
import { readSnss, type SnssSession } from './snss'
import { invoke } from '../tauri'

/** What a browser's profile came to: its sidebar, and what could not come with it. */
interface Read {
  sidebar: Sidebar
  lost: Lost[]
}

/** Only Firefox has containers to leave behind. */
const CONTAINERS: Lost = { text: key('Containers stay in Firefox') }

/** The profile written into its space; `several` where the browser keeps more than
 *  one profile. Answers the space, to land in. */
export async function landBrowser(profile: BrowserProfile, several: boolean): Promise<Space> {
  const browser = BROWSER_NAMES[profile.browser]
  const name = several ? `${browser} · ${profile.name}` : browser
  const firefox = profile.browser === 'firefox'
  const read = firefox ? await readFirefox(profile, name) : await readChromium(profile, name)
  const nothing = t('Nothing could be read out of {browser}.', { browser })
  if (!read) throw new Error(nothing)

  const { spaces, lost } = sidebarImport(read.sidebar, new Date(), firefox ? CONTAINERS : null)
  return landSpaces(spaces, [...lost, ...read.lost], nothing)
}

/** The names of the folders the import makes, in the reader's language. */
function folderWords(): FolderWords {
  return {
    bookmarks: t('Bookmarks'),
    savedGroups: t('Saved groups'),
    group: t('Tab group'),
    toolbar: t('Bookmarks toolbar'),
    bar: t('Bookmarks bar'),
    menu: t('Bookmarks menu'),
    other: t('Other bookmarks'),
    mobile: t('Mobile bookmarks'),
  }
}

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
  return { sidebar: firefoxSidebar(session, bookmarks, name, folderWords()), lost: [] }
}

/** A Chromium's session, the first of its files that reads, and its bookmarks. A
 *  session written encrypted is said in a line, and the bookmarks come alone. Null
 *  where neither is there. */
async function readChromium(profile: BrowserProfile, name: string): Promise<Read | null> {
  let session: SnssSession | null = null
  let locked = false
  for (const file of profile.files.filter((one) => one !== 'Bookmarks')) {
    const bytes = await browserFile(profile, file)
    const read = bytes ? readSnss(bytes) : null
    if (read === 'locked') locked = true
    else if (read) {
      session = read
      break
    }
  }

  const said = await browserFile(profile, 'Bookmarks')
  let bookmarks: unknown = null
  try {
    bookmarks = said ? (JSON.parse(new TextDecoder().decode(said)) as unknown) : null
  } catch {
    // A file Chromium was halfway through writing is no bookmarks rather than a refusal.
  }

  if (!session && !bookmarks) return null
  const lost: Lost[] =
    !session && locked
      ? [
          {
            text: key('{browser} keeps its open tabs locked, so only its bookmarks came.'),
            values: { browser: BROWSER_NAMES[profile.browser] },
          },
        ]
      : []
  return { sidebar: chromiumSidebar(session, bookmarks, name, folderWords()), lost }
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
