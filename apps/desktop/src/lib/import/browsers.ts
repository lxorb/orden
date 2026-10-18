/** The browsers on this machine the import can read, and one of their files.
 *
 *  The crate lists them out of each browser's own list of profiles and hands over the
 *  bytes of a file it has judged to be one of theirs; see browser_profiles.rs. What
 *  the bytes say is read here and in each browser's reader (firefox.ts, chromium.ts). Desktop
 *  only: everywhere else there are no profiles to read. */

import { fromBase64 } from '../bytes'
import { invoke, isDesktop } from '../tauri'

/** The browsers the import reads besides Zen, in the order the rows show them. All
 *  but Firefox are Chromium, and read alike (chromium.ts). */
export type BrowserId = 'firefox' | 'chrome' | 'edge' | 'brave' | 'chromium' | 'vivaldi'

/** A browser's name is its name in every language, as an app's is in the import. */
export const BROWSER_NAMES: Record<BrowserId, string> = {
  firefox: 'Firefox',
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
  chromium: 'Chromium',
  vivaldi: 'Vivaldi',
}

export interface BrowserProfile {
  browser: BrowserId
  name: string
  path: string
  /** The files of it the import reads, the one to read first in front. */
  files: string[]
}

/** One browser and its profiles, the one it opens first in front. */
export interface FoundBrowser {
  browser: BrowserId
  profiles: BrowserProfile[]
}

/** Every browser on this machine with anything to import. None off the desktop. */
export async function foundBrowsers(): Promise<FoundBrowser[]> {
  if (!isDesktop) return []
  try {
    const found =
      await invoke<{ id: BrowserId; profiles: Omit<BrowserProfile, 'browser'>[] }[]>(
        'browser_profiles',
      )
    return found
      .filter((one) => one.id in BROWSER_NAMES)
      .map((one) => ({
        browser: one.id,
        profiles: one.profiles.map((profile) => ({ ...profile, browser: one.id })),
      }))
  } catch {
    return []
  }
}

/** One of a profile's listed files, or null where it could not be read: a file the
 *  browser was halfway through writing is a file to step past, not a refusal. */
export async function browserFile(
  profile: BrowserProfile,
  file: string,
): Promise<Uint8Array | null> {
  return invoke<string>('read_browser_file', {
    browser: profile.browser,
    profile: profile.path,
    file,
  })
    .then(fromBase64)
    .catch(() => null)
}
