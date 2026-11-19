import { theme } from '../../../theme/src/api'
import type { ThemeSetting, ThemeValue } from '../../../theme/src/api'
import { rangeSetting } from '../translucent-settings'
import { ACCENT_PAIR, DAWN, isOwn, ownOf, PAIRS, shownOf, swatchOf } from './pairs'
import { DIALS, type Dials } from './tint'

const GLASS = 'glass'
export function glassValues(): Record<string, ThemeValue> {
  const values: Record<string, ThemeValue> = {}
  for (const id of ['follow', 'tint', 'pair', 'tab']) {
    const said = theme.values[id] ?? theme.keptFor(GLASS, id)
    if (said !== undefined) values[id] = said
  }
  return values
}
export function glassSettings(): ThemeSetting[] {
  return [
    {
      id: 'follow',
      label: 'Follow the page',
      hint: 'The frame takes its colour from what is open.',
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    rangeSetting('tint', 'Tint', 'How strongly the frame is coloured.', 0, 100, Math.round(DIALS.strength * 100), '%'),
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
  ]
}
export function dialsOf(values: Record<string, ThemeValue>): Dials {
  const percent = (value: ThemeValue | undefined, initial: number) =>
    Math.min(1, Math.max(0, (typeof value === 'number' ? value : initial * 100) / 100))
  return { strength: percent(values.tint, DIALS.strength) }
}
