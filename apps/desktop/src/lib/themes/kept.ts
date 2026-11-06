import { invoke } from '../tauri'
import { theme } from '../theme.svelte'
import { type BrowserTheme, ordenTheme } from './browser'
import { stamped } from './stamp'

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

export async function wearFirefoxTheme(one: BrowserTheme): Promise<void> {
  const css = ordenTheme(one)
  if (!css) throw new Error('that theme has no colours Orden can wear')
  theme.select(await keepTheme(one.name || 'Firefox theme', css, 'Firefox'))
}
