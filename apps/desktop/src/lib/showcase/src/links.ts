export const SITE_ORIGIN = 'https://orden.so'
export const APP_ORIGIN = 'https://app.orden.so'
export interface Origins {
  site: string
  app: string
}
const OURS = [SITE_ORIGIN, APP_ORIGIN].map((one) => new URL(one).hostname)
export function originsAt(at: { origin: string; hostname: string }): Origins {
  if (OURS.includes(at.hostname)) return { site: SITE_ORIGIN, app: APP_ORIGIN }
  return { site: at.origin, app: at.origin }
}
export interface AppHome {
  origin: string
  home: string
}
export function appHomeAt(at: { origin: string; hostname: string }, base: string): AppHome {
  if (base === '/' || base === '') {
    const { app } = originsAt(at)
    return { origin: app, home: app }
  }
  const under = base.startsWith('/') ? base : `/${base}`
  return { origin: at.origin, home: `${at.origin}${under.endsWith('/') ? under : `${under}/`}app` }
}
export const LATEST_RELEASE = 'https://github.com/lxorb/orden/releases/latest'
export const LATEST_RELEASE_API = 'https://api.github.com/repos/lxorb/orden/releases/latest'
const ASSET_HOME = 'https://github.com/lxorb/orden/releases/download/'
export interface Visitor {
  userAgent: string
  touchPoints?: number
  architecture?: string
  platform?: string | undefined
  coarse?: boolean
}
export interface ReleaseAsset {
  name: string
  url: string
}
interface Download {
  label: string
  href: string
}
type System = 'android' | 'ios' | 'macos' | 'windows' | 'linux'
const ARM_AGENT = /\b(?:aarch64|arm64|armv[78]l?)\b/i
const LABELS: Record<Exclude<System, 'ios'>, string> = {
  android: 'Download for Android',
  macos: 'Download for macOS',
  windows: 'Download for Windows',
  linux: 'Download for Linux',
}
const HINTS: Record<string, System | null> = {
  android: 'android',
  ios: 'ios',
  macos: 'macos',
  windows: 'windows',
  linux: 'linux',
  'chrome os': null,
  chromeos: null,
}
function hinted(platform: string | undefined): System | null | undefined {
  const key = platform?.trim().toLowerCase() ?? ''
  return key in HINTS ? HINTS[key] : undefined
}
function systemOf({ userAgent, touchPoints = 0, platform, coarse = false }: Visitor): System | null {
  const hint = hinted(platform)
  if (hint === 'android' || hint === 'ios') return hint
  if (/android/i.test(userAgent)) return 'android'
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios'
  if (hint === null || /\bcros\b/i.test(userAgent)) return null
  if (hint === 'macos' || /macintosh|mac os x/i.test(userAgent)) return touchPoints > 1 ? 'ios' : 'macos'
  if (hint === 'windows' || /windows/i.test(userAgent)) return 'windows'
  if (hint === 'linux' || /linux|x11/i.test(userAgent)) return coarse && touchPoints > 1 ? 'android' : 'linux'
  return null
}
function onArm({ userAgent, architecture }: Visitor): boolean {
  return ARM_AGENT.test(userAgent) || /^arm/i.test(architecture ?? '')
}
export const DOWNLOAD_ENDINGS = {
  'windows-x64': ['-windows-x64-setup.exe'],
  'windows-arm64': ['-windows-arm64-setup.exe'],
  'macos-arm64': ['-macos-arm64.dmg', '-macos-universal.dmg'],
  'macos-x64': ['-macos-x64.dmg', '-macos-universal.dmg'],
  macos: ['-macos-universal.dmg', '-macos-x64.dmg'],
  'linux-x64': ['-linux-x64.AppImage'],
  'linux-arm64': ['-linux-arm64.AppImage'],
  android: ['-android.apk'],
} as const
export type DownloadPlatform = keyof typeof DOWNLOAD_ENDINGS
export const DOWNLOAD_PATH = '/download'
export function isDownloadPlatform(name: unknown): name is DownloadPlatform {
  return typeof name === 'string' && Object.hasOwn(DOWNLOAD_ENDINGS, name)
}
function platformOf(system: Exclude<System, 'ios'>, visitor: Visitor): DownloadPlatform {
  if (system === 'android') return system
  if (system === 'macos') {
    if (/^arm/i.test(visitor.architecture ?? '')) return 'macos-arm64'
    return /^x86/i.test(visitor.architecture ?? '') ? 'macos-x64' : 'macos'
  }
  return `${system}-${onArm(visitor) ? 'arm64' : 'x64'}`
}
export function downloadFor(visitor: Visitor, site = SITE_ORIGIN, app = `${APP_ORIGIN}/`): Download {
  const system = systemOf(visitor)
  if (system === 'ios') return { label: 'Open the web app', href: app }
  if (!system) return { label: 'Download', href: `${site}${DOWNLOAD_PATH}` }
  return { label: LABELS[system], href: `${site}${DOWNLOAD_PATH}/${platformOf(system, visitor)}` }
}
export function assetFor(platform: DownloadPlatform | null, assets: readonly ReleaseAsset[]): string {
  if (!platform) return LATEST_RELEASE
  const ours = assets.filter(({ name, url }) => name.startsWith('Orden-') && url.startsWith(ASSET_HOME))
  for (const ending of DOWNLOAD_ENDINGS[platform]) {
    const asset = ours.find(({ name }) => name.endsWith(ending))
    if (asset) return asset.url
  }
  return LATEST_RELEASE
}
export function releaseTag(body: unknown): string | null {
  const tag = (body as { tag_name?: unknown } | null)?.tag_name
  return typeof tag === 'string' && tag !== '' ? tag : null
}
export function releaseAssets(body: unknown): ReleaseAsset[] {
  const assets = (body as { assets?: unknown } | null)?.assets
  if (!Array.isArray(assets)) return []
  return assets.flatMap((one: unknown) => {
    const { name, browser_download_url: url } = (one ?? {}) as { name?: unknown; browser_download_url?: unknown }
    return typeof name === 'string' && typeof url === 'string' ? [{ name, url }] : []
  })
}
export function releasedAt(body: unknown): Date | null {
  const published = (body as { published_at?: unknown } | null)?.published_at
  if (typeof published !== 'string') return null
  const at = new Date(published)
  return Number.isNaN(at.getTime()) ? null : at
}
const DAY = 24 * 60 * 60 * 1000
export function ageInWords(then: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
