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

import { dayOf, noteText, type Meta } from './meta'
import { Names, safeName, titleFrom } from './names'
import type { ImportPlan, Planned } from './plan'
import type { Source } from './sources'
import { element, tagsIn, textOf, textsOf, unescapeXml } from './xml'

/** What Tomboy calls a notebook membership. */
const NOTEBOOK = /^system:notebook:(.*)$/i

/** The tags that wrap words, and what they are in markdown. */
const AROUND: Record<string, string> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  highlight: '==',
  monospace: '`',
}

export async function readTomboy(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const written: Planned[] = []

  for (const source of sources) {
    if (!/\.note$/i.test(source.path)) continue

    const xml = await source.text()
    const content = element(xml, 'note-content')?.inner ?? ''
    const said = textOf(xml, 'title')?.trim() ?? ''

    const tags: string[] = []
    let notebook = ''

    for (const tag of textsOf(xml, 'tag')) {
      const found = NOTEBOOK.exec(tag.trim())
      if (found) notebook ||= safeName(found[1] ?? '')
      else if (tag.trim()) tags.push(tag.trim())
    }

    const body = withoutTitle(tomboyMarkdown(content), said)
    const title = (said ? safeName(said) : titleFrom(body)) ?? 'Untitled'

    const meta: Meta = { tags }
    const made = dayOf(textOf(xml, 'create-date'))
    const changed = dayOf(textOf(xml, 'last-change-date'))
    if (made) meta.date = made
    if (changed) meta.updated = changed

    written.push({
      kind: 'note',
      path: names.free(`${notebook ? `${notebook}/` : ''}${title}.md`),
      text: noteText(title, body, meta),
    })
  }

  return { format: 'tomboy', files: written, lost: [] }
}

/** Tomboy's markup as markdown.
 *
 *  A walk over the tags, because the lists nest and the emphasis is inside them.
 *  Anything this does not know about is dropped and its words are kept, which is
 *  the same thing the HTML converter does with a tag nobody has heard of. */
export function tomboyMarkdown(content: string): string {
  let out = ''
  let at = 0
  let depth = 0

  const write = (text: string) => {
    out += text
  }

  for (const tag of tagsIn(content)) {
    write(unescapeXml(content.slice(at, tag.from)))
    at = tag.to

    const name = tag.name.toLowerCase()
    const mark = AROUND[name]

    if (mark) {
      write(mark)
      continue
    }

    if (name === 'list') {
      // The blank line is what makes the first item a list rather than the tail
      // of the paragraph above it.
      if (!tag.closing) {
        depth += 1
        if (depth === 1 && !/\n\s*$/.test(out)) write('\n')
      } else depth = Math.max(0, depth - 1)
      continue
    }

    if (name === 'list-item') {
      if (!tag.closing) write(`\n${'  '.repeat(Math.max(0, depth - 1))}- `)
      continue
    }

    if (name === 'link:internal') {
      write(tag.closing ? ']]' : '[[')
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

/** Tomboy writes the title again as the first line of the content, which would
 *  otherwise be said twice in the note. */
function withoutTitle(body: string, title: string): string {
  if (!title) return body

  const lines = body.split('\n')
  if ((lines[0] ?? '').trim() !== title.trim()) return body

  return lines.slice(1).join('\n').replace(/^\s+/, '')
}
