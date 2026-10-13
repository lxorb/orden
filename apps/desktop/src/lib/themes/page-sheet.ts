/** A theme's stylesheet as a published page wears it.
 *
 *  The app says which scheme it is in with `data-theme` on the root, always. A
 *  published page does not: until the reader presses the button in its bar it
 *  follows their system, with no attribute at all, and its own tokens are stacked
 *  for that - the light ones as the default, the dark ones under
 *  `prefers-color-scheme: dark`, then the reader's own word over both (see
 *  scripts/blog-css.ts). A theme's `[data-theme='light']` block sent up as it was
 *  written matched nothing on such a page, so a site dressed in Warm Paper was
 *  dressed in it only for a reader who had pressed the button.
 *
 *  So the scheme blocks are restated the way the page's own are, in the same
 *  order and at the same weight, and land after them. A side the theme does not
 *  state is the page's own for that side, which is the one way round that never
 *  paints the theme's cream under the app's dark ink. Everything else - the
 *  shared `:root` block, the prose rules - goes as it was. */

import { rules } from './sample'

const SCHEME = /^\[data-theme\s*=\s*['"]?(light|dark)['"]?\s*\]$/

export function pageSheet(css: string): string {
  const shared: string[] = []
  const light: string[] = []
  const dark: string[] = []

  for (const { prelude, body } of rules(css)) {
    const parts = prelude.split(',').map((part) => part.trim())
    const schemes = parts.map((part) => SCHEME.exec(part)?.[1])

    if (!schemes.every(Boolean)) {
      shared.push(`${prelude} {${body}}`)
      continue
    }

    if (schemes.includes('light')) light.push(body)
    if (schemes.includes('dark')) dark.push(body)
  }

  return [
    ...shared,
    ...light.map((body) => `:root {${body}}`),
    ...dark.map(
      (body) => `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {${body}} }`,
    ),
    ...dark.map((body) => `:root[data-theme='dark'] {${body}}`),
    ...light.map((body) => `:root[data-theme='light'] {${body}}`),
    // Paper is light whatever the screen was, as the page's own tokens are.
    ...light.map((body) => `@media print { :root, :root[data-theme='dark'] {${body}} }`),
  ].join('\n')
}
