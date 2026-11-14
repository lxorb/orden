import { ACCENTS } from '../../theme/src/api'
import { readIcon } from '../../ui-kit/src/api'

const DRAWING = /^chrome:\/\/browser\/skin\/zen-icons\/(?:[\w-]+\/)*([\w-]+)\.svg$/i

const LUCIDE: Record<string, string> = {
  airplane: 'plane',
  basket: 'shopping-basket',
  build: 'hammer',
  cafe: 'coffee',
  call: 'phone',
  card: 'credit-card',
  chat: 'message-circle',
  checkbox: 'square-check',
  construct: 'construction',
  cutlery: 'utensils',
  'extension-puzzle': 'puzzle',
  'fast-food': 'hamburger',
  flask: 'flask-conical',
  'game-controller': 'gamepad-2',
  'globe-1': 'globe',
  'ice-cream': 'ice-cream-cone',
  lightning: 'zap',
  location: 'map-pin',
  'lock-closed': 'lock',
  'logo-github': 'git-branch',
  'logo-rss': 'rss',
  'logo-usd': 'dollar-sign',
  navigate: 'navigation',
  nuclear: 'radiation',
  page: 'file-text',
  paw: 'paw-print',
  people: 'users',
  planet: 'orbit',
  present: 'gift',
  school: 'graduation-cap',
  squares: 'copy',
  'star-1': 'star',
  'stats-chart': 'chart-column',
  tada: 'party-popper',
  time: 'clock',
  trash: 'trash-2',
  'volume-high': 'volume-2',
  warning: 'triangle-alert',
  water: 'droplet',
  weight: 'dumbbell',
}

const SAME = new Set([
  'bed',
  'bell',
  'book',
  'bookmark',
  'briefcase',
  'brush',
  'bug',
  'circle',
  'cloud',
  'code',
  'coins',
  'egg',
  'eye',
  'fish',
  'flag',
  'flame',
  'folder',
  'globe',
  'grid-2x2',
  'grid-3x3',
  'heart',
  'image',
  'inbox',
  'key',
  'layers',
  'leaf',
  'mail',
  'map',
  'megaphone',
  'moon',
  'music',
  'palette',
  'pizza',
  'rocket',
  'shapes',
  'shirt',
  'skull',
  'square',
  'star',
  'sun',
  'terminal',
  'ticket',
  'triangle',
  'video',
  'wallet',
])

export function zenIcon(value: string | null): string | null {
  if (!value) return null

  const drawn = DRAWING.exec(value.trim())
  if (drawn) {
    const name = (drawn[1] ?? '').toLowerCase()
    return LUCIDE[name] ?? (SAME.has(name) ? name : null)
  }

  const read = readIcon(value)
  return read?.kind === 'emoji' ? read.text : null
}

export const ZEN_DRAWINGS: readonly string[] = [...Object.values(LUCIDE), ...SAME]

export function zenTint(colour: readonly [number, number, number] | null): string | null {
  if (!colour) return null

  const [hue, saturation] = hsl(colour)
  if (saturation < 0.15) return 'slate'

  let nearest: string | null = null
  let distance = Infinity
  for (const accent of ACCENTS) {
    if (accent.id === 'slate') continue
    const [theirs] = hsl(rgbOf(accent.dark))
    const apart = Math.min(Math.abs(hue - theirs), 360 - Math.abs(hue - theirs))
    if (apart < distance) {
      distance = apart
      nearest = accent.id
    }
  }
  return nearest
}

function rgbOf(hex: string): [number, number, number] {
  const said = Number.parseInt(hex.slice(1), 16)
  return [(said >> 16) & 255, (said >> 8) & 255, said & 255]
}

function hsl([r, g, b]: readonly [number, number, number]): [number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const most = Math.max(red, green, blue)
  const least = Math.min(red, green, blue)
  const spread = most - least
  if (spread === 0) return [0, 0]

  const light = (most + least) / 2
  const saturation = spread / (1 - Math.abs(2 * light - 1))
  let hue =
    most === red
      ? ((green - blue) / spread) % 6
      : most === green
        ? (blue - red) / spread + 2
        : (red - green) / spread + 4
  hue *= 60
  return [hue < 0 ? hue + 360 : hue, saturation]
}
