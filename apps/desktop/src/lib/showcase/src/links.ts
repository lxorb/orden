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
function systemOf({ userAgent, touchPoints = 0 }: Visitor): System | null {
  if (/android/i.test(userAgent)) return 'android'
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios'
  if (/macintosh|mac os x/i.test(userAgent)) return touchPoints > 1 ? 'ios' : 'macos'
  if (/windows/i.test(userAgent)) return 'windows'
  if (/cros/i.test(userAgent)) return null
  if (/linux|x11/i.test(userAgent)) return 'linux'
  return null
}
function onArm({ userAgent, architecture }: Visitor): boolean {
  return ARM_AGENT.test(userAgent) || /^arm/i.test(architecture ?? '')
}
function endingFor(system: Exclude<System, 'ios'>, arm: boolean): string {
  if (system === 'android') return '-android.apk'
  if (system === 'macos') return '-macos-universal.dmg'
  if (system === 'windows') return arm ? '-windows-arm64-setup.exe' : '-windows-x64-setup.exe'
  return arm ? '-linux-arm64.AppImage' : '-linux-x64.AppImage'
}
export function downloadFor(visitor: Visitor, assets: readonly ReleaseAsset[] = []): Download {
  const system = systemOf(visitor)
  if (!system || system === 'ios') return { label: 'Download', href: LATEST_RELEASE }
  const ending = endingFor(system, onArm(visitor))
  const asset = assets.find(
    ({ name, url }) => name.startsWith('Orden-') && name.endsWith(ending) && url.startsWith(ASSET_HOME),
  )
  return { label: LABELS[system], href: asset?.url ?? LATEST_RELEASE }
}
export function releaseAssets(body: unknown): ReleaseAsset[] {
  const assets = (body as { assets?: unknown } | null)?.assets
  if (!Array.isArray(assets)) return []
  return assets.flatMap((one: unknown) => {
    const { name, browser_download_url: url } = (one ?? {}) as { name?: unknown; browser_download_url?: unknown }
    return typeof name === 'string' && typeof url === 'string' ? [{ name, url }] : []
  })
}
