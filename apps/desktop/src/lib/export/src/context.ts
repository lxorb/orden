import { protection } from '../../protect/src/api'
import type { EmbeddedNote } from '@orden/markdown'
import type { HtmlOptions } from './render'
import { attributeText, escapeAll } from '@orden/markdown/html'
import { decodeTarget } from '@orden/markdown/links'
import { mapSources } from '@orden/markdown/sources'
import { folderOf, imagePath, relativePath } from '../../platform/src/api'
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

function pictureFile(src: string, path: string | null, text: string): string | null {
  const name = decodeTarget(src)
  const found = links.fileFor(name, path)
  return found ?? imagePath(src, path, text)
}

function fromFolder(folder: string, file: string): string {
  return relativePath(folder.replace(/\\/g, '/'), file.replace(/\\/g, '/'))
    .split('/')
    .map(encodeURIComponent)
    .join('/')
}

function embeddedPictures(target: Target) {
  return (html: string, embedded: EmbeddedNote | null): string => {
    const own = target.path
    const path = embedded?.path
    if (own === null || !path) return html
    return mapSources(html, (src) => {
      const found = pictureFile(attributeText(src), path, embedded.text)
      return found === null ? null : escapeAll(fromFolder(folderOf(own), found))
    })
  }
}

export async function renderOptions(target: Target): Promise<RunOptions> {
  await links.spaceRead(target.path)
  return {
    page: choices.page,
    resolveImage: (src: string) => pictureFile(src, target.path, target.source) ?? src,
    pictures: embeddedPictures(target),
    readNote: (name: string) => links.embedNote(name, target.path),
    link: (link) => links.relativeTarget(link, target.path),
    escapeHtml: !target.trusted,
    ...(await look()),
  }
}
