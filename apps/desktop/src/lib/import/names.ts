import { freePath, withoutForbidden } from '@orden/markdown/paths'
import { isReserved } from '../naming'

const LONGEST = 96

const NOTION_ID = /[ -][0-9a-f]{32}$/i

export function looksLikePapers(paths: readonly string[]): boolean {
  const picked = paths.filter((one) => !isJunk(one))
  return picked.length > 0 && picked.every((one) => /\.pdf$/i.test(one))
}

export function isJunk(path: string): boolean {
  const name = path.split('/').pop() ?? path
  return (
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === 'desktop.ini' ||
    name === 'Icon\r' ||
    name.startsWith('._') ||
    path.startsWith('__MACOSX/') ||
    path.includes('/__MACOSX/')
  )
}

export function safeName(title: string): string {
  const one = withoutForbidden(title.replace(/\s+/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .replace(/^\.+ *(?=.)/, '_')
    .replace(/^\.+$/, '')

  const short = one.length > LONGEST ? one.slice(0, LONGEST).trimEnd() : one
  if (!short) return 'Untitled'
  return undeviced(short)
}

export function keptName(name: string, extension = ''): string {
  const own = extension ? (/[. ]*$/.exec(name)?.[0] ?? '') : ''
  const lead = /^ */.exec(name)?.[0] ?? ''
  const freed = withoutForbidden(name.slice(lead.length, name.length - own.length))
  const rest = `${lead}${freed.trimStart()}`
  const one = extension ? `${rest.trimEnd()}${own}` : rest.replace(/[. ]+$/, '')
  if (!one.trim()) return 'Untitled'
  return undeviced(one)
}

function undeviced(name: string): string {
  const at = name.indexOf('.')
  const first = at < 0 ? name : name.slice(0, at)
  return isReserved(first) ? `${first}-${name.slice(first.length)}` : name
}

export function withoutNotionId(name: string): string {
  if (NOTION_ID.test(name)) return name.replace(NOTION_ID, '')
  const at = name.lastIndexOf('.')
  const stem = at > 0 ? name.slice(0, at) : name
  const extension = at > 0 ? name.slice(at) : ''
  return `${stem.replace(NOTION_ID, '')}${extension}`
}

export function hasNotionId(name: string): boolean {
  const at = name.lastIndexOf('.')
  return NOTION_ID.test(at > 0 ? name.slice(0, at) : name)
}

export function safeParts(
  path: string,
  each: (part: string) => string = (part) => part,
  named: (part: string, extension?: string) => string = safeName,
): string {
  const parts = path.split('/').filter(Boolean)
  const last = parts.pop() ?? ''
  const at = last.lastIndexOf('.')
  const stem = at > 0 ? last.slice(0, at) : last
  const extension = at > 0 ? last.slice(at) : ''

  const folders = parts.map((one) => named(each(one)))
  const name = `${named(each(stem), extension)}${extension}`

  return [...folders, name].join('/')
}

export function titleFrom(text: string): string | null {
  for (const line of text.split('\n')) {
    const said = line.trim()
    if (!said) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(said)
    return safeName((heading?.[1] ?? said).slice(0, LONGEST))
  }

  return null
}

export function nameKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

export class Names {
  private readonly taken = new Set<string>()

  private readonly kept = new Set<string>()

  free(path: string, own = false): string {
    const free = freePath(path, (candidate) => {
      const key = nameKey(candidate)
      return this.taken.has(key) || (this.kept.has(key) && !(own && candidate === path))
    })
    this.taken.add(nameKey(free))
    return free
  }

  keep(path: string) {
    this.kept.add(nameKey(path))
  }

  hold(path: string) {
    this.taken.add(nameKey(path))
  }

  has(path: string): boolean {
    return this.taken.has(nameKey(path))
  }
}
