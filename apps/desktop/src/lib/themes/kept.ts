/** A browser's theme, kept as one of Orden's: written into the themes folder under an id no
 *  installed theme has yet, where any other theme is. What Settings > Appearance imports
 *  from a browser on this computer (settings/BrowserThemes.svelte), and what a Firefox
 *  theme installed from addons.mozilla.org becomes (web-tab/extensions.svelte.ts). */

import { invoke } from '../tauri'
import { theme } from '../theme.svelte'
import { type BrowserTheme, ordenTheme } from './browser'
import { stamped } from './stamp'

/** Writes `css` as a theme called `name`, answering the id it is chosen by. */
export async function keepTheme(name: string, css: string, author: string): Promise<string> {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 36) || 'theme'
  let id = slug
  for (let n = 2; theme.all.some((held) => held.id === `file:${id}`); n++) id = `${slug}-${n}`

  await invoke('write_theme', {
    id,
    css: stamped({ id, name, author, version: '1' }, css),
  })
  await theme.reload()
  return `file:${id}`
}

/** A Firefox theme as one of Orden's, kept and worn. */
export async function wearFirefoxTheme(one: BrowserTheme): Promise<void> {
  const css = ordenTheme(one)
  if (!css) throw new Error('that theme has no colours Orden can wear')
  theme.select(await keepTheme(one.name || 'Firefox theme', css, 'Firefox'))
}
