import type { HtmlOptions } from '../export'
import { t } from '../i18n.svelte'
import { imagePath } from '../images'
import { links } from '../link-index.svelte'
import { modes } from '../modes.svelte'
import { settings } from '../settings.svelte'
import { trustsHtmlIn } from '../sharing.svelte'
import { theme } from '../theme.svelte'
import { invoke, isNative } from '../tauri'
import { carriedCss } from '../themes/carried'
import { workspace } from '../workspace.svelte'
import type { RunOptions } from './run'

export interface Target {
  source: string
  name: string
  path: string | null
  trusted: boolean
}

export const frontShut = (): boolean => workspace.protection.locked(workspace.active?.path)

export function openTarget(): Target {
  if (frontShut()) throw new Error(t('Protected'))
  workspace.wordsNow()
  const note = workspace.active

  return {
    source: note?.doc ?? '',
    name: note?.name ?? 'Untitled.md',
    path: note?.path ?? null,
    trusted: note ? trustsHtmlIn(note.note) : true,
  }
}

export async function look(): Promise<
  Pick<HtmlOptions, 'scheme' | 'accent' | 'codeTheme' | 'css'>
> {
  const chosen = { accent: theme.accent, codeTheme: modes.codeTheme }
  if (settings.exportAppearance !== 'app') return { ...chosen, scheme: settings.exportAppearance }

  const file = theme.active.path
  const sheets = await Promise.all([
    file
      ? invoke<string>('read_theme', { path: file })
          .then(carriedCss)
          .catch(() => '')
      : '',
    isNative
      ? invoke<string>('read_custom_css')
          .then(carriedCss)
          .catch(() => '')
      : '',
  ])

  return { ...chosen, scheme: theme.current, css: sheets.filter((css) => css.trim()).join('\n') }
}

export async function renderOptions(target: Target): Promise<RunOptions> {
  await links.spaceRead(target.path)
  return {
    page: settings.page,
    resolveImage: (src: string) => imagePath(src, target.path, target.source) ?? src,
    readNote: (name: string) => links.embedNote(name, target.path),
    link: (link) => links.relativeTarget(link, target.path),
    escapeHtml: !target.trusted,
    ...(await look()),
  }
}
