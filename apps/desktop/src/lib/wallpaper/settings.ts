import type { ThemeSetting, ThemeValue } from '../themes/settings'
import { theme } from '../theme.svelte'
import {
  ACCENT_SWATCH,
  contentOf,
  contentSetting,
  rangeSetting as range,
  tintColourSetting,
} from '../translucent-settings'
import { type Dials, type Fit, FITS } from './look'

const FIT_NAMES: Record<Fit, string> = {
  fill: 'Fill',
  fit: 'Fit',
  tile: 'Tile',
  centre: 'Centre',
}

export function wallpaperSettings(): ThemeSetting[] {
  return [
    range('blur', 'Blur', 'How much the picture is blurred.', 0, 60, 28, 'px'),
    {
      ...range('dim', 'Dim', 'How much the picture is darkened.', 0, 90, 10, '%'),
      paint: (value) => ({ '--orden-dim': `${String(value)}%` }),
    },
    range(
      'saturation',
      'Saturation',
      'How vivid the colours of the picture are.',
      0,
      200,
      100,
      '%',
    ),
    range('tint', 'Tint', 'How strongly the tint colour lies over the picture.', 0, 100, 0, '%'),
    tintColourSetting('tint-colour', () => Number(theme.values.tint ?? 0) > 0),
    range('grain', 'Grain', 'Adds a film grain over the picture.', 0, 100, 0, '%'),
    {
      id: 'fit',
      label: 'Fit',
      hint: 'How the picture fills the window.',
      own: true,
      kind: 'choice',
      options: FITS.map((value) => ({ value, label: FIT_NAMES[value] })),
      initial: 'fill',
      paint: () => ({}),
    },
    {
      id: 'empty',
      label: 'Empty panes',
      hint: 'An empty pane shows the picture rather than paper.',
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    contentSetting(),
  ]
}

function isFit(value: unknown): value is Fit {
  return FITS.includes(value as Fit)
}

export function dialsOf(values: Record<string, ThemeValue>): Dials {
  return {
    blur: Number(values.blur ?? 28),
    dim: Number(values.dim ?? 10),
    grain: Number(values.grain ?? 0),
    fit: isFit(values.fit) ? values.fit : 'fill',
    empty: values.empty !== false,
    content: contentOf(values.content),
  }
}

export interface Tone {
  saturation: number
  tint: number
  colour: string
}

export function toneOf(values: Record<string, ThemeValue>, accent: string): Tone {
  const chosen = String(values['tint-colour'] ?? ACCENT_SWATCH)
  return {
    saturation: Number(values.saturation ?? 100) / 100,
    tint: Number(values.tint ?? 0) / 100,
    colour: chosen === ACCENT_SWATCH ? accent : chosen,
  }
}
