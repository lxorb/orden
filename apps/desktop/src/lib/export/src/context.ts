import { protection } from '../../protect/src/api'
import type { HtmlOptions } from './render'
import { imagePath } from '../../platform/src/api'
import { links } from '../../link-index/src/api'
import { modes, choices } from '../../modes/src/api'
import { trustsHtmlIn } from '../../sharing/src/api'
import { theme, carriedCss } from '../../theme/src/api'
import { invoke, isNative } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import type { RunOptions } from './run'

export interface Target {
  source: string
  name: string
  path: string | null
  trusted: boolean
}

export const frontShut = (): boolean => protection.locked(workspace.active?.path)

export function openTarget(): Target {
  if (frontShut()) throw new Error('Protected')
  workspace.wordsNow()
  const note = workspace.active

  return {
    source: note?.doc ?? '',
    name: note?.name ?? 'Untitled.md',
    path: note?.path ?? null,
    trusted: note ? trustsHtmlIn(note.note) : true,
  }
}

export function openOut() {
  const target = openTarget()
  return {
    text: target.source,
    name: target.name,
    path: target.path,
    root: workspace.rootHolding(target.path),
    shared: workspace.active?.note.shared ?? null,
    trusted: target.trusted,
  }
}

async function look(): Promise<Pick<HtmlOptions, 'scheme' | 'accent' | 'codeTheme' | 'css'>> {
  const chosen = { accent: theme.accent, codeTheme: modes.codeTheme }
  if (choices.exportAppearance !== 'app') return { ...chosen, scheme: choices.exportAppearance }

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
    page: choices.page,
    resolveImage: (src: string) =>
      links.fileFor(src, target.path) ?? imagePath(src, target.path, target.source) ?? src,
    readNote: (name: string) => links.embedNote(name, target.path),
    link: (link) => links.relativeTarget(link, target.path),
    escapeHtml: !target.trusted,
    ...(await look()),
  }
}
