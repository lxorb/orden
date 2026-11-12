import {
  USAGE_ARCH,
  USAGE_OS,
  type UsageApp,
  type UsageSystem,
  type DailyPing,
} from '@orden/sync-core'
type Common = Omit<DailyPing, 'v' | 'kind' | 'day'>

export interface Seen {
  version: string
  channel: string
  native: { platform?: string; version?: string; arch?: string } | null
  mobile: boolean
  agent: string
  language: string
  width: number
  signedIn: boolean
}

function among<T extends string>(value: string | undefined, list: readonly T[]): T {
  return list.find((one) => one === value) ?? ('other' as T)
}

function osFromAgent(agent: string): UsageSystem['os'] {
  if (agent.includes('Android')) return 'android'
  if (/iPhone|iPad|iPod/.test(agent)) return 'ios'
  if (agent.includes('Mac')) return 'macos'
  if (agent.includes('Win')) return 'windows'
  if (/Linux|X11/.test(agent)) return 'linux'
  return 'other'
}

function engineOf(os: UsageSystem['os'], native: boolean, agent: string): UsageSystem['engine'] {
  if (native) {
    if (os === 'windows') return 'webview2'
    if (os === 'android') return 'chromium'
    return os === 'other' ? 'other' : 'webkit'
  }
  if (agent.includes('Firefox/')) return 'gecko'
  if (/Chrom(e|ium)\//.test(agent)) return 'chromium'
  if (agent.includes('Safari/')) return 'webkit'
  return 'other'
}

function screenOf(width: number): Common['screen'] {
  if (width < 600) return 'small'
  if (width < 1200) return 'medium'
  if (width < 2000) return 'large'
  return 'huge'
}

export function commonOf(seen: Seen): Common {
  const native = seen.native
  const os = native ? among(native.platform, USAGE_OS) : osFromAgent(seen.agent)
  const osVersion = native?.version?.match(/^\d{1,5}(?:\.\d{1,5})?/)?.[0]
  const app: UsageApp = {
    version: seen.version.replace(/\+.*$/, ''),
    channel: seen.channel === 'unstable' ? 'unstable' : 'stable',
  }
  return {
    app,
    system: {
      os,
      ...(osVersion ? { osVersion } : {}),
      arch: native ? among(native.arch, USAGE_ARCH) : 'other',
      form: native ? (seen.mobile ? 'mobile' : 'desktop') : 'web',
      engine: engineOf(os, !!native, seen.agent),
    },
    language: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,4}){0,2}$/.test(seen.language) ? seen.language : 'en',
    screen: screenOf(seen.width),
    signedIn: seen.signedIn,
  }
}
