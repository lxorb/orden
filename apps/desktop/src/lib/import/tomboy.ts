import { plainWords } from '@orden/markdown/escapes'
import { asWords, OPENS_MARKUP } from '@orden/markdown/words'

import { dayOf, noteText, type Meta } from './meta'
import { nameKey, Names, safeName, titleFrom } from './names'
import type { ImportPlan, Planned } from './plan'
import type { Source } from './sources'
import { closingOf, element, tagsIn, textOf, textsOf, unescapeXml } from './xml'

const NOTEBOOK = /^system:notebook:(.*)$/i

const SYSTEM = /^system:/i

const AROUND: Record<string, string> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  strikeout: '~~',
  highlight: '==',
  monospace: '`',
}

const UNLINKABLE = /[[\]|#^]/

interface Read {
  content: string
  title: string
  path: string
  meta: Meta
}

export async function readTomboy(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const notes: Read[] = []
  const byTitle = new Map<string, string>()
  let unreadable = 0

  for (const source of sources) {
    if (!/\.note$/i.test(source.path)) continue

    const xml = await source.text()
    const said = textOf(xml, 'title')?.trim() ?? ''
    const words = element(xml, 'note-content')

    if (!said && !words) {
      unreadable += 1
      continue
    }

    const content = withoutTitle(words?.inner ?? '', said)

    const tags: string[] = []
    let notebook = ''

    for (const tag of textsOf(xml, 'tag')) {
      const found = NOTEBOOK.exec(tag.trim())
      if (found) notebook ||= safeName(found[1] ?? '')
      else if (tag.trim()) tags.push(tag.trim().replace(SYSTEM, ''))
    }

    const title = (said ? safeName(said) : titleFrom(tomboyMarkdown(content))) ?? 'Untitled'

    const meta: Meta = { tags }
    const made = dayOf(textOf(xml, 'create-date'))
    const changed = dayOf(textOf(xml, 'last-change-date'))
    if (made) meta.date = made
    if (changed) meta.updated = changed

    const path = names.free(`${notebook ? `${notebook}/` : ''}${title}.md`)
    notes.push({ content, title, path, meta })
    if (said && !byTitle.has(nameKey(said))) byTitle.set(nameKey(said), path)
  }

  const named = new Map<string, number>()
  for (const note of notes) {
    const key = nameKey(fileName(note.path))
    named.set(key, (named.get(key) ?? 0) + 1)
  }

  const written: Planned[] = notes.map((note) => {
    const link = (title: string) => {
      const target = byTitle.get(nameKey(title.trim()))
      return target
        ? linkTo(target, note.path, title, (named.get(nameKey(fileName(target))) ?? 0) > 1)
        : linkTo(`${safeName(title)}.md`, '', title, false)
    }

    return {
      kind: 'note',
      path: note.path,
      text: noteText(note.title, tomboyMarkdown(note.content, link), note.meta),
    }
  })

  const lost = unreadable
    ? [
        unreadable === 1
          ? '1 file could not be read, so it was left out'
          : `${unreadable} files could not be read, so they were left out`,
      ]
    : []

  return { format: 'tomboy', files: written, lost }
}

export function tomboyMarkdown(
  content: string,
  link: (title: string) => string = (title) => `[[${title}]]`,
): string {
  const out: string[] = []
  let at = 0
  let depth = 0
  let listEnd = -1
  const open: { name: string; from: number }[] = []
  let item = false

  let words = ''

  const flush = () => {
    if (words) out.push(plainWords(words))
    words = ''
  }

  const write = (text: string) => {
    flush()
    if (text) out.push(text)
  }

  const tail = () => {
    flush()
    let end = ''
    for (let at = out.length - 1; at >= 0 && end.length < 256; at -= 1) end = `${out[at]}${end}`
    return end
  }

  const cut = (count: number) => {
    flush()
    let left = count
    while (left > 0 && out.length) {
      const last = out.pop() ?? ''
      if (last.length > left) out.push(last.slice(0, last.length - left))
      left -= last.length
    }
  }

  const said = (text: string) => {
    if (!item) {
      words += text
      return
    }

    const trimmed = text.replace(/^[ \t]+/, '')
    if (trimmed) item = false
    words += trimmed
  }

  for (const tag of tagsIn(content)) {
    if (tag.from < at) continue

    said(unescapeXml(content.slice(at, tag.from)))
    at = tag.to

    const name = tag.name.toLowerCase()
    const mark = AROUND[name]
    if (mark || name === 'list' || name === 'list-item' || name === 'link:internal') flush()

    if (mark) {
      if (!tag.closing) {
        open.push({ name, from: out.length })
        continue
      }

      const which = open.map((one) => one.name).lastIndexOf(name)
      if (which < 0) continue

      const from = Math.min(open[which]?.from ?? out.length, out.length)
      open.splice(which)
      if (listEnd > from) listEnd = -1
      write(marked(out.splice(from).join(''), mark))
      continue
    }

    if (name === 'list') {
      if (!tag.closing) {
        depth += 1
        if (depth === 1) {
          const between = listEnd >= 0 && listEnd <= out.length ? out.slice(listEnd).join('') : null
          if (between !== null && /^[ \t]*(\n[ \t]*){0,2}$/.test(between)) {
            out.length = listEnd
          } else if (out.length && !/\n\s*\n\s*$/.test(tail())) {
            write(/\n\s*$/.test(tail()) ? '\n' : '\n\n')
          }
        }
      } else {
        depth = Math.max(0, depth - 1)
        if (depth === 0) {
          if (!tail().endsWith('\n')) write('\n')
          listEnd = out.length
          write('\n')
        }
      }
      continue
    }

    if (name === 'list-item') {
      if (!tag.closing) {
        cut(/[ \t]*$/.exec(tail())?.[0].length ?? 0)
        if (out.length && !tail().endsWith('\n')) write('\n')
        write(`${'  '.repeat(Math.max(0, depth - 1))}- `)
        item = true
      }
      continue
    }

    if (name === 'link:internal' && !tag.closing && !tag.empty) {
      const closes = closingOf(content, tag.name, tag.to)
      const after = content.indexOf('>', closes)
      const title = unescapeXml(content.slice(tag.to, closes).replace(/<[^>]*>/g, ''))
      write(title.trim() ? link(title.replace(/\s+/g, ' ').trim()) : title)
      at = after < 0 ? content.length : after + 1
      continue
    }
  }

  said(unescapeXml(content.slice(at)))
  flush()

  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function marked(text: string, mark: string): string {
  return text
    .split('\n')
    .map((line) => {
      const [, lead = '', words = '', tail = ''] = /^(\s*(?:- )?\s*)(.*?)(\s*)$/.exec(line) ?? []
      if (!words) return line
      return `${lead}${mark === '`' ? code(unescaped(words)) : `${mark}${words}${mark}`}${tail}`
    })
    .join('\n')
}

function unescaped(words: string): string {
  return words.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

function code(words: string): string {
  const longest = (words.match(/`+/g) ?? [])
    .map((run) => run.length)
    .reduce((high, one) => Math.max(high, one), 0)
  const fence = '`'.repeat(longest + 1)
  const pad = words.startsWith('`') || words.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${words}${pad}${fence}`
}

function withoutTitle(content: string, title: string): string {
  if (!title) return content

  const end = content.indexOf('\n')
  const first = end < 0 ? content : content.slice(0, end)
  if (unescapeXml(first.replace(/<[^>]*>/g, '')).trim() !== title) return content

  return end < 0 ? '' : content.slice(end + 1)
}

function stem(path: string): string {
  return path.replace(/\.md$/i, '')
}

function fileName(path: string): string {
  return stem(path.split('/').pop() ?? path)
}

function linkTo(to: string, from: string, title: string, shared: boolean): string {
  const name = shared ? stem(to) : fileName(to)

  if (!UNLINKABLE.test(name)) {
    const shown = /[\]|\n]/.test(title) || title === name ? '' : `|${title}`
    return `[[${name}${shown}]]`
  }

  return `[${asWords(title.replace(LITERAL, (one) => `\\${one}`))}](${encoded(relative(to, from))})`
}

const LITERAL = new RegExp(`\\\\(?!\\\\*${OPENS_MARKUP.source})|[[\\]]`, 'g')

function relative(to: string, from: string): string {
  const here = from.split('/').slice(0, -1)
  const there = to.split('/')
  let same = 0
  while (same < here.length && same < there.length - 1 && here[same] === there[same]) same += 1

  return [...here.slice(same).map(() => '..'), ...there.slice(same)].join('/')
}

function encoded(path: string): string {
  return path
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\^/g, '%5E')
}
