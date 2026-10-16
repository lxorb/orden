/** What a render of the open note needs that only the running app knows.
 *
 *  An export and a print are the same page twice: the note through the renderer,
 *  with the paper from the settings, the colours on screen or the ones chosen for
 *  export, every picture resolved to where it actually is, and every wikilink
 *  pointed at the file it names. Written down once here so a printed page and an
 *  exported one cannot disagree about any of it. */

import type { HtmlOptions } from '../export'
import { imagePath } from '../images'
import { links } from '../link-index.svelte'
import { modes } from '../modes.svelte'
import { settings } from '../settings.svelte'
import { theme } from '../theme.svelte'
import { invoke, isNative } from '../tauri'
import { workspace } from '../workspace.svelte'
import type { RunOptions } from './run'

/** The note being rendered, and where it lives. The same shape run.ts calls a
 *  note, so a target goes straight to it. */
export interface Target {
  source: string
  name: string
  path: string | null
}

/** The note in front of somebody, read as text.
 *
 *  Flushed first: the editor's last few keystrokes are still a rope until
 *  something asks for them as a string, and this is asking. */
export function openTarget(): Target {
  workspace.flush()
  const note = workspace.active

  return {
    source: note?.doc ?? '',
    name: note?.name ?? 'Untitled.md',
    path: note?.path ?? null,
  }
}

/** How a rendered page should look: the colours chosen for export, or the ones on
 *  screen right now, theme file and custom CSS included. */
export async function look(): Promise<
  Pick<HtmlOptions, 'scheme' | 'accent' | 'codeTheme' | 'css'>
> {
  const chosen = { accent: theme.accent, codeTheme: modes.codeTheme }
  if (settings.exportAppearance !== 'app') return { ...chosen, scheme: settings.exportAppearance }

  const file = theme.active.path
  const sheets = await Promise.all([
    file ? invoke<string>('read_theme', { path: file }).catch(() => '') : '',
    isNative ? invoke<string>('read_custom_css').catch(() => '') : '',
  ])

  return { ...chosen, scheme: theme.current, css: sheets.filter((css) => css.trim()).join('\n') }
}

/** Everything a render needs beyond the note itself: paper, colours, where the
 *  pictures it names actually are, and where its links point. */
export async function renderOptions(target: Target): Promise<RunOptions> {
  return {
    page: settings.page,
    resolveImage: (src: string) => imagePath(src, target.path, target.source) ?? src,
    // An `![[Note]]` in the document brings that note into it, the way it shows in
    // the editor. Read here rather than in the renderer, which is sync.
    readNote: (name: string) => links.embedSource(name, target.path),
    // A wikilink written out as markdown points at the file it named, relative to
    // this note, so the export reads in any other editor.
    link: (link) => links.relativeTarget(link, target.path),
    ...(await look()),
  }
}
