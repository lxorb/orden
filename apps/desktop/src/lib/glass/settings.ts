/** Glass's own dials, said in code behind the theme's door (see `own` in
 *  theme.svelte.ts).
 *
 *  Windows Terminal is the role model for what is offered: which material, and how much
 *  of the window's colour lies over it, all the way to none of the desk at all. Arc's
 *  theme is the one for the colour: follow what is open, and where nothing open has a
 *  colour, glass's own two (pairs.ts) - one of the pairs it offers, or two of the
 *  reader's own.
 *  What glass adds is the floor: the Opacity dial's track is grey below the least wash
 *  the frame's words read on over the material, and the knob stops there; see tint.ts.
 *
 *  The material and the opacity are a desktop's: where the platform puts nothing behind
 *  the window - a Mac's opaque webview, Linux, a browser, a phone - glass is the frame
 *  taking its colour from what is open, and those rows would turn nothing. */

import { t } from '../i18n.svelte'
import { isDesktop, platform } from '../tauri'
import { theme } from '../theme.svelte'
import type { ThemeSetting, ThemeValue } from '../themes/settings'
import { contentSetting, rangeSetting } from '../translucent-settings'
import { chrome } from './chrome.svelte'
import { ACCENT_PAIR, DAWN, isOwn, ownOf, PAIRS, shownOf, swatchOf } from './pairs'
import { DIALS, type Dials } from './tint'

/** The theme's id, which is also the drawer its dials are kept in. */
const GLASS = 'glass'

/** Each material the row offers, by the word the crate is asked with. */
const MATERIALS = {
  'mica-alt': 'Mica Alt',
  mica: 'Mica',
  acrylic: 'Acrylic',
  clear: 'No blur',
} as const

/** Whether there is a material to choose: Windows, today (see `hasMaterial` in
 *  theme.svelte.ts), or a window the root says stands on one. */
function hasMaterial(): boolean {
  return (isDesktop && platform() === 'windows') || chrome.material !== null
}

/** Glass's dials as they stand: what is tried, else what was kept - read off the kept
 *  drawer too, for a launch whose settings door has not opened yet - else nothing, which
 *  is where each starts. */
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
            label: t('Material'),
            own: true,
            reapplies: true,
            kind: 'choice',
            options: Object.entries(MATERIALS).map(([value, name]) => ({ value, label: t(name) })),
            initial: 'mica-alt',
            paint: () => ({}),
          },
          {
            ...rangeSetting('opacity', t('Opacity'), 0, 100, Math.round(DIALS.opacity * 100), '%'),
            least: () => Math.ceil(chrome.floor * 100),
          },
        ] satisfies ThemeSetting[])
      : []),
    {
      id: 'follow',
      label: t('Follow the page'),
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    rangeSetting('tint', t('Tint'), 0, 100, Math.round(DIALS.strength * 100), '%'),
    {
      id: 'pair',
      label: t('Tint colour'),
      own: true,
      kind: 'colour',
      initial: DAWN.id,
      options: [
        ...PAIRS.map((pair) => ({
          value: pair.id,
          name: t(pair.name),
          dark: swatchOf(pair, 'dark'),
          light: swatchOf(pair, 'light'),
        })),
        { value: ACCENT_PAIR, name: t('Accent'), dark: 'var(--accent)', light: 'var(--accent)' },
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
      label: t('Coloured tab'),
      own: true,
      kind: 'switch',
      initial: true,
      paint: () => ({}),
    },
    ...(material ? [contentSetting()] : []),
  ]
}

/** The dials tint.ts works the frame out with, out of the settings' values. */
export function dialsOf(values: Record<string, ThemeValue>): Dials {
  const percent = (value: ThemeValue | undefined, initial: number) =>
    Math.min(1, Math.max(0, (typeof value === 'number' ? value : initial * 100) / 100))
  return {
    opacity: percent(values.opacity, DIALS.opacity),
    strength: percent(values.tint, DIALS.strength),
  }
}
