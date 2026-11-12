import { plainWords } from '@orden/markdown/escapes'
import { htmlToMarkdown } from '@orden/markdown/from-html'

import { folderPlan, isJunk, isNoteFile } from './folder'
import type { Meta } from './meta'
import { keptName, Names, safeName, safeParts, withoutNotionId } from './names'
import type { FormatId, ImportPlan } from './plan'
import type { Source } from './sources'

const HTML = /\.(html?|xhtml)$/i

const TEXT = /\.txt$/i

const PLAIN_TEXT: ReadonlySet<FormatId> = new Set(['apple-notes'])

const MARKDOWN_SAYS = [
  /^#{1,6}[ \t]+\S/m,
  /^(`{3,}|~{3,})/m,
  /^>[ \t]/m,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /\[\[[^\]\n]+\]\]/,
  /(\*\*|__)\S[^\n]*?\S\1/,
  /(^|\s)\*\S(?:[^*\n]*\S)?\*(?=[\s.,;:!?)]|$)/m,
  /(^|[\s("'])_\S[^_\n]*\S_(?=[\s.,;:!?)"'\]-]|$)/m,
  /(^|[\s("'])~~\S(?:[^~\n]*\S)?~~(?=[\s.,;:!?)"'\]-]|$)/m,
  /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\](?=[ \t]|$)/m,
]

function textWords(text: string, format: FormatId | undefined): string {
  const plain = format !== undefined && PLAIN_TEXT.has(format)
  if (!plain && MARKDOWN_SAYS.some((pattern) => pattern.test(text))) return text
  return plainWords(text)
}

const BUNDLE_TEXT = /\.textbundle\/text\.(md|markdown|txt)$/i

export interface PlainOptions {
  format?: FormatId
  skip?: (path: string) => boolean
  words?: (text: string, source: Source) => string
  meta?: (source: Source) => Meta | undefined
  asTheyAre?: boolean
}

export async function readPlain(
  sources: readonly Source[],
  options: PlainOptions = {},
): Promise<ImportPlan> {
  const names = new Names()
  let html = 0

  const note = (path: string) =>
    options.asTheyAre ? /\.(md|markdown)$/i.test(path) : isNoteFile(path)

  const target = (source: Source): string | null => {
    if (isJunk(source.path) || options.skip?.(source.path)) return null

    const path = options.asTheyAre
      ? (placedPath(source.path, undefined, keptName)?.trimStart() ?? null)
      : placedPath(source.path, withoutNotionId)
    if (path === null) return null

    if (HTML.test(path) && !options.asTheyAre) return path.replace(HTML, '.md')
    return note(path) ? path.replace(/\.txt$/i, '.md') : path
  }

  for (const source of sources) {
    if (target(source) === source.path) names.keep(source.path)
  }

  const plan = await folderPlan(sources, {
    format: options.format ?? 'markdown',
    place: (source) => {
      const path = target(source)
      if (path === null) return { to: null }
      const to = names.free(path, path === source.path)

      if (HTML.test(source.path) && !options.asTheyAre) {
        html += 1
        return {
          to,
          read: (text) => ({
            text: htmlToMarkdown(text, {
              fileTargets: true,
              appTargets: true,
              mediaLinks: true,
              plainTasks: true,
            }),
            title: null,
          }),
        }
      }

      if (!note(path)) return { to }

      return {
        to,
        read: (text, at) => {
          const said = TEXT.test(at.path) ? textWords(text, options.format) : text
          return {
            text: options.words?.(said, at) ?? said,
            title: null,
            meta: options.meta?.(at) ?? {},
            kept: options.asTheyAre === true,
            own: true,
          }
        },
      }
    },
  })

  if (html) {
    plan.lost.push(`${html} pages came as HTML, so their words are kept and their look is not`)
  }

  return plan
}

function placedPath(
  path: string,
  each?: (part: string) => string,
  named: (part: string, extension?: string) => string = safeName,
): string | null {
  if (BUNDLE_TEXT.test(path)) {
    const bundle = path.replace(/\/text\.(md|markdown|txt)$/i, '')
    return `${safeParts(bundle.replace(/\.textbundle$/i, ''), each, named)}.md`
  }

  const inside = /\.textbundle\/(.*)$/i.exec(path)
  if (inside) {
    const rest = inside[1] ?? ''
    if (/^info\.json$/i.test(rest)) return null
    return safeParts(rest, each, named)
  }

  return safeParts(path, each, named)
}
