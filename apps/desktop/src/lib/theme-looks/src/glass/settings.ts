import { isDesktop, platform } from '../../../platform/src/api'
import { theme, chrome } from '../../../theme/src/api'
import type { ThemeSetting, ThemeValue } from '../../../theme/src/api'
import { contentSetting, rangeSetting } from '../translucent-settings'
import { ACCENT_PAIR, DAWN, isOwn, ownOf, PAIRS, shownOf, swatchOf } from './pairs'
import { DIALS, type Dials } from './tint'

const GLASS = 'glass'

const MATERIALS = {
  'mica-alt': 'Mica Alt',
  mica: 'Mica',
  acrylic: 'Acrylic',
  clear: 'No blur',
} as const

function hasMaterial(): boolean {
  return (isDesktop && platform() === 'windows') || chrome.material !== null
}

export function glassValues(): Record<string, ThemeValue> {
  const values: Record<string, ThemeValue> = {}
  for (const id of ['material', 'opacity', 'follow', 'tint', 'pair', 'tab', 'content']) {
    const said = theme.values[id] ?? theme.keptFor(GLASS, id)
    if (said !== undefined) values[id] = said
  }
  return values
}

export function glassSettings(): ThemeSetting[] {
  const material = hasMaterial()
  return [
    ...(material
      ? ([
          {
            id: 'material',
            label: 'Material',
            hint: 'What Windows draws behind the window: Mica, Acrylic, or no blur.',
            own: true,
            reapplies: true,
            kind: 'choice',
            options: Object.entries(MATERIALS).map(([value, name]) => ({ value, label: name })),
            initial: 'mica-alt',
            paint: () => ({}),
          },
          {
            ...rangeSetting(
              'opacity',
              'Opacity',
              'How much of the window’s own colour lies over what is behind it.',
              0,
              100,
              Math.round(DIALS.opacity * 100),
              '%',
            ),
            least: () => Math.ceil(chrome.floor * 100),
          },
        ] satisfies ThemeSetting[])
      : []),
    {
      id: 'follow',
      label: 'Follow the page',
      hint: 'The frame takes its colour from what is open.',
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    rangeSetting(
      'tint',
      'Tint',
      'How strongly the frame is coloured.',
      0,
      100,
      Math.round(DIALS.strength * 100),
      '%',
    ),
    {
      id: 'pair',
      label: 'Tint colour',
      hint: 'The colours the frame takes where nothing open has a colour of its own.',
      own: true,
      kind: 'colour',
      initial: DAWN.id,
      options: [
        ...PAIRS.map((pair) => ({
          value: pair.id,
          name: pair.name,
          dark: swatchOf(pair, 'dark'),
          light: swatchOf(pair, 'light'),
        })),
        { value: ACCENT_PAIR, name: 'Accent', dark: 'var(--accent)', light: 'var(--accent)' },
      ],
      pair: {
        accepts: isOwn,
        colours: (held, scheme) => shownOf(held, scheme, theme.accent),
        of: ownOf,
      },
      paint: () => ({}),
    },
    {
      id: 'tab',
      label: 'Coloured tab',
      hint: 'A web tab takes the colour of its page.',
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    ...(material ? [contentSetting()] : []),
  ]
}

export function dialsOf(values: Record<string, ThemeValue>): Dials {
  const percent = (value: ThemeValue | undefined, initial: number) =>
    Math.min(1, Math.max(0, (typeof value === 'number' ? value : initial * 100) / 100))
  return {
    opacity: percent(values.opacity, DIALS.opacity),
    strength: percent(values.tint, DIALS.strength),
  }
}
