import { lexMarkdown, withoutComments } from '@orden/markdown'
import { coverOf } from '@orden/markdown/cover'
import { frontMatterValue, stripFrontMatter } from '@orden/markdown/front-matter'
import { withoutBlockIds } from '@orden/markdown/links'
import type { Env } from './types'

const FRONT_PICTURES = ['image'] as const

const PICTURE = /\/i\/([a-f0-9]{64})(?:\.[a-z0-9]+)?(?:[?#].*)?$/i

const ANYWHERE = /\/i\/([a-f0-9]{64})(?![a-f0-9])/gi

export function picturesOf(source: string, liveHtml = false): Set<string> {
  const found = new Set<string>()
  const add = (address: string | null | undefined) => {
    const hash = address ? PICTURE.exec(address.trim())?.[1] : undefined
    if (hash) found.add(hash.toLowerCase())
  }
  const html = liveHtml
    ? (markup: string) => {
        const plain = decoded(markup).replace(/[\t\n\f\r ]+/g, '')
        for (const match of plain.matchAll(ANYWHERE))
          if (match[1]) found.add(match[1].toLowerCase())
      }
    : (markup: string) => {
        for (const address of drawnByHtml(markup)) add(address)
      }

  const canvas = cardsOf(source)
  if (canvas) {
    for (const card of canvas) {
      if (card.type === 'file') add(card.file)
      add(card.background)
      if (typeof card.text === 'string') {
        for (const hash of picturesOf(card.text, liveHtml)) found.add(hash)
      }
    }
    return found
  }

  add(coverOf(source)?.src)
  for (const key of FRONT_PICTURES) add(frontMatterValue(source, key))

  const tokens = lexMarkdown(withoutComments(withoutBlockIds(stripFrontMatter(source))))
  visit(tokens, add, html)
  return found
}

function visit(
  value: unknown,
  add: (address: string | undefined) => void,
  html: (markup: string) => void,
): void {
  if (Array.isArray(value)) {
    for (const one of value) visit(one, add, html)
    return
  }
  if (!value || typeof value !== 'object') return

  const token = value as { type?: unknown; href?: unknown; text?: unknown; link?: unknown }
  if (token.type === 'code' || token.type === 'codespan') return
  if (token.type === 'image' && typeof token.href === 'string') add(token.href)
  if (token.type === 'html' && typeof token.text === 'string') {
    html(token.text)
  }
  if (token.type === 'embed' || token.type === 'wikilink') {
    const link = token.link as { embed?: boolean; target?: string } | undefined
    if (link?.embed) add(link.target)
  }

  for (const inner of Object.values(token)) {
    if (inner && typeof inner === 'object') visit(inner, add, html)
  }
}

interface Card {
  type: unknown
  file: string | undefined
  background: string | undefined
  text: unknown
}

function cardsOf(source: string): Card[] | null {
  if (!source.trimStart().startsWith('{')) return null
  try {
    const parsed = JSON.parse(source) as { nodes?: unknown }
    if (!Array.isArray(parsed.nodes)) return null
    return parsed.nodes
      .filter((node): node is Record<string, unknown> => !!node && typeof node === 'object')
      .map((node) => ({
        type: node.type,
        file: typeof node.file === 'string' ? node.file : undefined,
        background: typeof node.background === 'string' ? node.background : undefined,
        text: node.text,
      }))
  } catch {
    return null
  }
}

export async function keepPictures(
  env: Env,
  note: { id: string; space_id: string },
  content: string,
): Promise<boolean> {
  try {
    const live = await htmlIsLive(env, note.space_id)
    await env.DB.batch([
      env.DB.prepare('delete from note_pictures where note_id = ?').bind(note.id),
      env.DB.prepare(
        `insert or ignore into note_pictures (note_id, hash)
           select ?1, value from json_each(?2)`,
      ).bind(note.id, JSON.stringify([...picturesOf(content, live)])),
    ])
    return true
  } catch {
    await env.DB.prepare('update notes set front_rev = 0 where id = ?')
      .bind(note.id)
      .run()
      .catch(() => undefined)
    return false
  }
}

export async function htmlIsLive(env: Env, spaceId: string): Promise<boolean> {
  const shared = await env.DB.prepare(
    `select 1 as one from space_members where space_id = ?1
     union all select 1 from space_links where space_id = ?1
     union all select 1 from guest_members where space_id = ?1
     limit 1`,
  )
    .bind(spaceId)
    .first()
  return !shared
}

export function forgetPictures(env: Env, noteId: string): D1PreparedStatement {
  return env.DB.prepare('delete from note_pictures where note_id = ?').bind(noteId)
}

const DRAWN = new Set(['src', 'srcset', 'poster', 'style'])

function drawnByHtml(html: string): string[] {
  const found: string[] = []
  let at = 0
  while ((at = html.indexOf('<', at)) !== -1) {
    const name = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(at, at + 64))
    if (!name) {
      at += 1
      continue
    }
    at += name[0].length

    while (at < html.length && html[at] !== '>') {
      const attribute = /^[\s/]*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/.exec(
        html.slice(at),
      )
      if (!attribute?.[0]) {
        at += 1
        continue
      }
      at += attribute[0].length
      const key = attribute[1]?.toLowerCase() ?? ''
      const value = decoded(attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
      if (!DRAWN.has(key)) continue
      if (key === 'src' || key === 'poster') found.push(value)
      if (key === 'srcset') {
        for (const candidate of value.split(',')) found.push(candidate.trim().split(/\s+/)[0] ?? '')
      }
      if (key === 'style') {
        for (const match of value.matchAll(/url\(\s*["']?([^"')]+)/gi)) found.push(match[1] ?? '')
      }
    }
  }
  return found
}

const NAMED: Record<string, string> = {
  amp: '&',
  sol: '/',
  colon: ':',
  period: '.',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  lpar: '(',
  rpar: ')',
  tab: '\t',
  newline: '\n',
  nbsp: '\u00a0',
}

function decoded(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (whole, said: string) => {
    if (said.startsWith('#')) {
      const code =
        said[1] === 'x' || said[1] === 'X'
          ? parseInt(said.slice(2), 16)
          : parseInt(said.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return NAMED[said.toLowerCase()] ?? whole
  })
}
