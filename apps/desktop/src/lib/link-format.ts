import { encodeTarget, slugify, wikilinkCannotName } from '@orden/markdown/links'
import { folderOf, nameOf, relativePath } from './space-paths'

export type LinkFormat = 'wikilink' | 'shortest' | 'relative' | 'absolute'

export const LINK_FORMATS: readonly LinkFormat[] = ['wikilink', 'shortest', 'relative', 'absolute']

export function isLinkFormat(value: unknown): value is LinkFormat {
  return typeof value === 'string' && (LINK_FORMATS as readonly string[]).includes(value)
}

let writing: LinkFormat = 'wikilink'

export function setLinkWriting(format: LinkFormat) {
  writing = format
}

export function linkWriting(): LinkFormat {
  return writing
}

export interface LinkTarget {
  name: string
  path?: string | null
  from?: string | null
  fragment?: string | null
  shown?: string | null
  embed?: boolean
}

export function formatLink(target: LinkTarget, format: LinkFormat): string {
  const bang = target.embed ? '!' : ''
  const fragment = target.fragment ?? ''
  const shown = target.shown && (target.shown !== target.name || fragment) ? target.shown : ''

  if (format === 'wikilink' && !beyondWikilink(target.name, fragment, shown)) {
    const inner = fragment ? `${target.name}#${fragment}` : target.name
    return `${bang}[[${inner}${shown ? `|${shown}` : ''}]]`
  }

  const label = (shown || target.name || bareFragment(fragment)).replace(/[\\[\]|]/g, '\\$&')
  const anchor = fragment ? `#${markdownFragment(fragment)}` : ''
  const path = pathFor(target, format === 'wikilink' ? 'shortest' : format)

  return `${bang}[${label}](${encodeTarget(path)}${anchor})`
}

function beyondWikilink(name: string, fragment: string, shown: string): boolean {
  return wikilinkCannotName(name) || /[[\]|]/.test(fragment) || /[[\]]/.test(shown)
}

function pathFor(target: LinkTarget, format: Exclude<LinkFormat, 'wikilink'>): string {
  if (!target.path && !target.name) return ''

  const path = target.path ?? withExtension(target.name)
  if (format === 'absolute') return path
  if (format === 'shortest') return target.name.includes('/') ? path : withExtension(nameOf(path))
  return target.from ? relativePath(folderOf(target.from), path) : path
}

function bareFragment(fragment: string): string {
  return fragment.startsWith('^') ? fragment.slice(1) : fragment
}

const EXTENSION = /\.[^./]+$/

function withExtension(name: string): string {
  return EXTENSION.test(name) ? name : `${name}.md`
}

function markdownFragment(fragment: string): string {
  if (fragment.startsWith('^') || /^page=\d+$/i.test(fragment)) return fragment
  return slugify(fragment)
}
