/** The window's frame, as a setting beside the theme (#1088): Rounded, what is open in
 *  a rounded card floating a little in from the chrome, the top bar and the sidebars one
 *  surface round it, as Firefox draws its window; or Square, the window as it was before,
 *  flush and square and divided by lines.
 *
 *  A theme setting rather than a mode, because what it changes is tokens: the card's
 *  corner, how far it stands in, the room between a split's cards, what sets a card off
 *  the chrome, and the lines and grounds of the chrome itself (see the frame block in
 *  tokens.css). Everything that touches the frame reads those, so this is the one place
 *  that says what each choice is. Shared, so it follows the reader across themes. */

import { t } from './i18n.svelte'
import type { ThemeSetting } from './themes/settings'

export type Corners = 'rounded' | 'square'

export const DEFAULT_CORNERS: Corners = 'rounded'

/** The frame's tokens for each choice. `initial` leaves a token unset, so what reads it
 *  falls back to the theme's own: a sidebar's ground, a strip's line. */
const TOKENS: Record<Corners, Record<string, string>> = {
  rounded: {
    '--card-radius': '10px',
    '--card-inset': '6px',
    '--card-gap': '6px',
    '--card-edge': 'var(--line)',
    '--card-shadow': '0 1px 3px rgb(0 0 0 / 0.12)',
    '--chrome-ground': 'var(--tab-frame)',
    '--chrome-seam': 'transparent',
    '--side-ground': 'transparent',
    '--strip-line': 'transparent',
  },
  square: {
    '--card-radius': '0px',
    '--card-inset': '0px',
    '--card-gap': '1px',
    '--card-edge': 'transparent',
    '--card-shadow': 'none',
    '--chrome-ground': 'transparent',
    '--chrome-seam': 'var(--line)',
    '--side-ground': 'initial',
    '--strip-line': 'initial',
  },
}

const isCorners = (value: unknown): value is Corners => value === 'rounded' || value === 'square'

/** The tokens `value` writes. Anything that is not a choice is the default. */
export function cornerTokens(value: unknown): Record<string, string> {
  return TOKENS[isCorners(value) ? value : DEFAULT_CORNERS]
}

export function cornersSetting(): ThemeSetting {
  return {
    id: 'corners',
    label: t('Window corners'),
    hint: t('Rounded floats what is open in a card inside the window; Square keeps it flush.'),
    shared: true,
    kind: 'choice',
    initial: DEFAULT_CORNERS,
    options: [
      { value: 'rounded', label: t('Rounded') },
      { value: 'square', label: t('Square') },
    ],
    paint: (value) => cornerTokens(value),
  }
}
