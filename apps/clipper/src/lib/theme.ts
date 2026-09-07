/** Light or dark, the way the app decides it.
 *
 *  The tokens put dark on `:root` and light behind `[data-theme='light']`, so
 *  painting a page is writing one attribute; see
 *  `packages/themes/src/tokens.css` and `apps/desktop/src/lib/theme.svelte.ts`. */

import type { Theme } from './settings'

const LIGHT = '(prefers-color-scheme: light)'

function isLight(choice: Theme): boolean {
  return choice === 'light' || (choice === 'system' && matchMedia(LIGHT).matches)
}

/** Paints the page, and keeps painting it while the choice is the system's:
 *  the options page can be open when somebody changes it. */
export function applyTheme(choice: Theme): void {
  document.documentElement.dataset.theme = isLight(choice) ? 'light' : 'dark'
}

export function followSystem(current: () => Theme): void {
  matchMedia(LIGHT).addEventListener('change', () => {
    applyTheme(current())
  })
}
