export const APP_HREF = '/'
const RELEASES = 'https://github.com/lxorb/orden/releases'
export const LATEST_RELEASE = `${RELEASES}/latest`
export interface Visitor {
  userAgent: string
  touchPoints?: number
  architecture?: string
}
interface Download {
  label: string
  href: string
}
type System = 'android' | 'ios' | 'macos' | 'windows' | 'linux'
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const ARM_AGENT = /\b(?:aarch64|arm64|armv[78]l?)\b/i
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
export function downloadFor(visitor: Visitor, version: string): Download {
  const system = systemOf(visitor)
  if (!system || system === 'ios' || !VERSION.test(version)) return { label: 'Download', href: LATEST_RELEASE }
  const file = (rest: string) => `${RELEASES}/download/v${version}/Orden-${version}-${rest}`
  const arm = onArm(visitor)
  if (system === 'android') return { label: 'Download for Android', href: file('android.apk') }
  if (system === 'macos') return { label: 'Download for macOS', href: file('macos-universal.dmg') }
  if (system === 'windows')
    return { label: 'Download for Windows', href: file(arm ? 'windows-arm64-setup.exe' : 'windows-x64-setup.exe') }
  return { label: 'Download for Linux', href: file(arm ? 'linux-arm64.AppImage' : 'linux-x64.AppImage') }
}
