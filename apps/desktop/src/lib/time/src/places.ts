import { brandIcon, siteBrand } from '../../ui-kit/src/api'
import { isTabKind, TAB_KINDS, type TabKind } from '../../tab-kinds/src/api'

export const OWN_ICON = `${import.meta.env.BASE_URL}icon-256.png`
export const ownApp = (key: string): boolean => key.trim().toLowerCase() === 'orden'
export function tabKindOf(key: string): TabKind | null {
  const named = /^([a-z-]+):/.exec(key)?.[1]
  if (named && isTabKind(named)) return named
  const lower = key.toLowerCase()
  const found = (Object.keys(TAB_KINDS) as TabKind[]).find((kind) => {
    const ending = TAB_KINDS[kind].extension
    return ending !== null && lower.endsWith(ending)
  })
  return found ?? null
}

const APPS: Readonly<Record<string, string>> = {
  orden: 'orden',
  firefox: 'firefox',
  'firefox developer edition': 'firefoxbrowser',
  chrome: 'googlechrome',
  'google chrome': 'googlechrome',
  chromium: 'googlechrome',
  code: 'visualstudiocode',
  'visual studio code': 'visualstudiocode',
  slack: 'slack',
  spotify: 'spotify',
  discord: 'discord',
  zed: 'zedindustries',
  obsidian: 'obsidian',
  notion: 'notion',
  figma: 'figma',
  telegram: 'telegram',
  'telegram desktop': 'telegram',
  whatsapp: 'whatsapp',
  signal: 'signal',
  thunderbird: 'thunderbird',
  steam: 'steam',
  teams: 'microsoftteams',
  'microsoft teams': 'microsoftteams',
  brave: 'brave',
  'brave browser': 'brave',
  safari: 'safari',
  edge: 'microsoftedge',
  msedge: 'microsoftedge',
  'microsoft edge': 'microsoftedge',
  vlc: 'vlcmediaplayer',
  gimp: 'gimp',
  blender: 'blender',
  zoom: 'zoom',
}
const TITLES: Readonly<Record<string, string>> = {
  orden: 'Orden',
  firefox: 'Firefox',
  firefoxbrowser: 'Firefox',
  googlechrome: 'Google Chrome',
  visualstudiocode: 'Visual Studio Code',
  zedindustries: 'Zed',
  microsoftteams: 'Microsoft Teams',
  microsoftedge: 'Microsoft Edge',
  vlcmediaplayer: 'VLC',
  gimp: 'GIMP',
  whatsapp: 'WhatsApp',
}
export function appName(key: string, label: string): string {
  const slug = APPS[key.trim().toLowerCase()] ?? APPS[label.trim().toLowerCase()]
  if (slug) return TITLES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1)
  return label.charAt(0).toLocaleUpperCase() + label.slice(1)
}
export function siteIcon(host: string): string | null {
  const slug = siteBrand(`https://${host}`)
  return slug ? brandIcon(slug) : null
}
export function appIcon(key: string): string | null {
  const slug = APPS[key.trim().toLowerCase()]
  return slug ? brandIcon(slug) : null
}
export function lightness(pixels: ArrayLike<number>): number | null {
  let sum = 0
  let weight = 0
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    const alpha = (pixels[at + 3] ?? 0) / 255
    if (alpha < 0.5) continue
    const [red, green, blue] = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0]
    sum += ((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255) * alpha
    weight += alpha
  }
  return weight > 0 ? sum / weight : null
}
export type Plate = 'light' | 'dark' | null
export const UNSEEN = 'unseen'
export function plateFor(light: number | typeof UNSEEN | null, scheme: 'light' | 'dark'): Plate {
  if (light === UNSEEN) return scheme === 'dark' ? 'light' : null
  if (light === null) return null
  if (scheme === 'dark' && light < 0.3) return 'light'
  if (scheme === 'light' && light > 0.85) return 'dark'
  return null
}
