/** Tomboy and Gnote notes: one `.note` file each, XML, with the words in a
 *  `<note-content>`.
 *
 *  The content is not HTML. It is Tomboy's own markup - `<bold>`, `<italic>`,
 *  `<highlight>`, `<list>` and `<link:internal>` - so it is walked here rather
 *  than handed to the HTML converter, which would drop every one of those tags and
 *  leave the words in a heap.
 *
 *  `<link:internal>Another note</link:internal>` is a link to another note by its
 *  title, which is exactly a wikilink, so those come over whole: a Tomboy notebook
 *  arrives with its links still working.
 *
 *  A notebook is a tag of the form `system:notebook:Work`, which becomes a folder,
 *  because that is what a notebook is. Every other tag is a tag. */

import { key } from '../i18n.svelte'

import { dayOf, noteText, type Meta } from './meta'
import { nameKey, Names, safeName, titleFrom } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'
import { closingOf, element, tagsIn, textOf, textsOf, unescapeXml } from './xml'

/** What Tomboy calls a notebook membership. */
const NOTEBOOK = /^system:notebook:(.*)$/i

/** Tomboy's own tags, `system:template` for a notebook's template, which are a
 *  tag by the name after the prefix. */
const SYSTEM = /^system:/i

/** The tags that wrap words, and what they are in markdown. Tomboy writes a line
 *  through as `strikethrough`, tomboy-ng as `strikeout`. */
const AROUND: Record<string, string> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  strikeout: '~~',
  highlight: '==',
  monospace: '`',
}

/** What a wikilink cannot hold in its name: a `]` or a `|` ends it, and a `#` or
 *  a `^` would point into the note rather than at it. */
const UNLINKABLE = /[[\]|#^]/

/** One note, read before any is written, since a link names its target by title
 *  and the target's file name is only known once every name has been given out. */
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

    // Neither a title nor any words: not a note, or one cut short before either.
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

  // How many notes a bare name would reach, so a link to one of two notes of the
  // same name in two notebooks names its folder too.
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

  const lost: Lost[] = unreadable
    ? [
        {
          text: key('{count} files could not be read, so they were left out'),
          one: '{count} file could not be read, so it was left out',
          values: { count: unreadable },
        },
      ]
    : []

  return { format: 'tomboy', files: written, lost }
}

/** Tomboy's markup as markdown.
 *
 *  A walk over the tags, because the lists nest and the emphasis is inside them.
 *  Anything this does not know about is dropped and its words are kept, which is
 *  the same thing the HTML converter does with a tag nobody has heard of.
 *
 *  `link` writes a link to the note of that title; a wikilink by the title as it
 *  is, unless told otherwise. */
export function tomboyMarkdown(
  content: string,
  link: (title: string) => string = (title) => `[[${title}]]`,
): string {
  let out = ''
  let at = 0
  let depth = 0
  // Where the last list at the top closed, so a list straight after it is the
  // same list carried on rather than a new one after a gap.
  let listEnd = -1
  const open: { name: string; from: number }[] = []

  const write = (text: string) => {
    out += text
  }

  for (const tag of tagsIn(content)) {
    if (tag.from < at) continue

    write(unescapeXml(content.slice(at, tag.from)))
    at = tag.to

    const name = tag.name.toLowerCase()
    const mark = AROUND[name]

    if (mark) {
      if (!tag.closing) {
        open.push({ name, from: out.length })
        continue
      }

      const which = open.map((one) => one.name).lastIndexOf(name)
      if (which < 0) continue

      const from = open[which]?.from ?? out.length
      open.splice(which)
      out = out.slice(0, from) + marked(out.slice(from), mark)
      continue
    }

    if (name === 'list') {
      if (!tag.closing) {
        depth += 1
        if (depth === 1) {
          // The blank line is what makes the first item a list rather than the
          // tail of the paragraph above it. Tomboy-ng writes each item as a
          // list of its own, which is still one list.
          if (listEnd >= 0 && /^[ \t]*(\n[ \t]*){0,2}$/.test(out.slice(listEnd))) {
            out = out.slice(0, listEnd)
          } else if (out && !/\n\s*\n\s*$/.test(out)) write(/\n\s*$/.test(out) ? '\n' : '\n\n')
        }
      } else {
        depth = Math.max(0, depth - 1)
        if (depth === 0) {
          // And a blank line after it, so the words that follow are not taken
          // for more of the last item.
          if (!out.endsWith('\n')) write('\n')
          listEnd = out.length
          write('\n')
        }
      }
      continue
    }

    if (name === 'list-item') {
      // An item's own line ending is inside it, so a new item only starts a line
      // where the last one did not end one.
      if (!tag.closing) {
        out = out.replace(/[ \t]+$/, '')
        if (out && !out.endsWith('\n')) write('\n')
        write(`${'  '.repeat(Math.max(0, depth - 1))}- `)
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

    // A size is how big Tomboy drew it, which markdown has no word for outside a
    // heading, and a heading in the middle of a note would be a change of shape.
  }

  write(unescapeXml(content.slice(at)))

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Words wrapped in a mark, a line at a time, since emphasis in markdown does not
 *  run over a line break, and with the spaces at either end left outside it,
 *  since `** bold **` is not bold. A list item's dash stays in front. Nothing at
 *  all is marked where there are no words. */
function marked(text: string, mark: string): string {
  return text
    .split('\n')
    .map((line) => {
      const [, lead = '', words = '', tail = ''] = /^(\s*(?:- )?\s*)(.*?)(\s*)$/.exec(line) ?? []
      if (!words) return line
      return `${lead}${mark === '`' ? code(words) : `${mark}${words}${mark}`}${tail}`
    })
    .join('\n')
}

/** Words as inline code, fenced with more backticks than they hold in a row. */
function code(words: string): string {
  const longest = Math.max(0, ...(words.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = words.startsWith('`') || words.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${words}${pad}${fence}`
}

/** Tomboy writes the title again as the first line of the content, which would
 *  otherwise be said twice in the note. Taken off the markup rather than the
 *  markdown, so a title Tomboy drew underlined or bold is still found. */
function withoutTitle(content: string, title: string): string {
  if (!title) return content

  const end = content.indexOf('\n')
  const first = end < 0 ? content : content.slice(0, end)
  if (unescapeXml(first.replace(/<[^>]*>/g, '')).trim() !== title) return content

  return end < 0 ? '' : content.slice(end + 1)
}

/** A path without its `.md`. */
function stem(path: string): string {
  return path.replace(/\.md$/i, '')
}

/** The name a wikilink calls the note at a path by. */
function fileName(path: string): string {
  return stem(path.split('/').pop() ?? path)
}

/** A link from the note at `from` to the one at `to`, showing the title it had.
 *  A wikilink by the file's name, or its path where another note shares it; a
 *  markdown link where the name holds what a wikilink cannot. */
function linkTo(to: string, from: string, title: string, shared: boolean): string {
  const name = shared ? stem(to) : fileName(to)

  if (!UNLINKABLE.test(name)) {
    const shown = /[\]|\n]/.test(title) || title === name ? '' : `|${title}`
    return `[[${name}${shown}]]`
  }

  const words = title.replace(/[\\[\]]/g, (one) => `\\${one}`)
  return `[${words}](${encoded(relative(to, from))})`
}

/** Where `to` is from the folder of the note at `from`. */
function relative(to: string, from: string): string {
  const here = from.split('/').slice(0, -1)
  const there = to.split('/')
  let same = 0
  while (same < here.length && same < there.length - 1 && here[same] === there[same]) same += 1

  return [...here.slice(same).map(() => '..'), ...there.slice(same)].join('/')
}

/** A path as a link's target: the characters a target cannot hold as themselves
 *  encoded, the way the import's own link rewriting writes them. */
function encoded(path: string): string {
  return path
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\^/g, '%5E')
}
