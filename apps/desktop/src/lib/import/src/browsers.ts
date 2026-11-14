import { fromBase64, invoke, isDesktop } from '../../platform/src/api'

export type BrowserId =
  | 'safari'
  | 'firefox'
  | 'chrome'
  | 'edge'
  | 'brave'
  | 'chromium'
  | 'vivaldi'
  | 'opera'
  | 'opera-gx'
  | 'arc'

export const BROWSER_NAMES: Record<BrowserId, string> = {
  safari: 'Safari',
  firefox: 'Firefox',
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
  chromium: 'Chromium',
  vivaldi: 'Vivaldi',
  opera: 'Opera',
  'opera-gx': 'Opera GX',
  arc: 'Arc',
}

export const BROWSER_LOGOS: Record<BrowserId, string | null> = {
  safari: 'safari',
  firefox: 'firefox',
  chrome: 'googlechrome',
  edge: 'microsoftedge',
  brave: 'brave',
  chromium: null,
  vivaldi: 'vivaldi',
  opera: 'opera',
  'opera-gx': 'operagx',
  arc: 'arc',
}

export const ZEN_LOGO = 'zenbrowser'

export interface BrowserProfile {
  browser: BrowserId
  name: string
  path: string
  files: string[]
}

export interface FoundBrowser {
  browser: BrowserId
  name: string
  profiles: BrowserProfile[]
}

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
        name: BROWSER_NAMES[one.id],
        profiles: one.profiles.map((profile) => ({ ...profile, browser: one.id })),
      }))
  } catch {
    return []
  }
}

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
