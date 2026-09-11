/** A Logseq graph.
 *
 *  A graph is a folder: `pages/` for the notes somebody named, `journals/` for the
 *  ones the date named, `assets/` for the files, and `logseq/` for the app's own
 *  settings, which are not notes and do not come.
 *
 *  Three things are Logseq's own:
 *
 *  `key:: value` at the top of a note is a property, which becomes front matter -
 *  that is where nib keeps a note's properties and what `[key:value]` searches.
 *
 *  `((a-uuid))` is a reference to one block somewhere else in the graph. nib has
 *  block links of its own, but they point at a block in one note by a name that
 *  note carries, and a Logseq uuid is not that name. So a reference is replaced
 *  with what the block said, which is what the reader was looking at anyway, and
 *  the count is said out loud. A reference to a block nothing exported is left as
 *  it was written rather than emptied.
 *
 *  `TODO`, `DOING`, `NOW`, `LATER` and `DONE` in front of a bullet are Logseq's
 *  task markers, and they become task list items: a box is a box.
 *
 *  A journal is renamed to the date it is: `2026_09_11.md` is `2026-09-11.md`, so
 *  a year of them sorts in the file list. */

import { key } from '../i18n.svelte'

import { folderPlan, isJunk } from './folder'
import { dayOf, type Meta } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan } from './plan'
import type { Source } from './sources'

/** Logseq's own folder, which holds its settings and its caches. */
const APP = /^logseq\//i

/** A property line: `key:: value`, at the top of a note or of its first block. */
const PROPERTY = /^\s*(?:-\s+)?([A-Za-z][\w -]{0,39}):: *(.*)$/

/** The five words Logseq puts in front of a bullet to make it a task. */
const MARKER = /^(\s*)-\s+(TODO|DOING|NOW|LATER|DONE|CANCELED|CANCELLED)\s+/

/** A block reference. */
const REFERENCE = /\(\(([0-9a-f-]{36})\)\)/gi

/** The id a block carries so others can point at it. */
const BLOCK_ID = /^\s*(?:-\s+)?id:: *([0-9a-f-]{36})\s*$/i

export async function readLogseq(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const blocks = await blocksById(sources)
  let flattened = 0

  const plan = await folderPlan(sources, {
    format: 'logseq',
    place: (source) => {
      if (isJunk(source.path) || APP.test(source.path)) return { to: null }

      const path = placed(source.path)
      if (!/\.(md|markdown)$/i.test(path)) return { to: names.free(path) }

      return {
        to: names.free(path),
        read: (text) => {
          const said = logseqNote(text, blocks)
          flattened += said.flattened
          return { text: said.body, title: null, meta: said.meta }
        },
      }
    },
  })

  if (flattened) {
    plan.lost.push({
      text: key('{count} block references were written out as the words they pointed at'),
      values: { count: flattened },
    })
  }

  return plan
}

/** Where a file of the graph goes. Journals keep their folder and gain their
 *  proper name; everything else keeps the shape it had, minus the `pages/` that
 *  only said "this is a page". */
function placed(path: string): string {
  const journal = /^journals\/(.+)\.(md|markdown)$/i.exec(path)
  if (journal) {
    const day = dayOf(journal[1]?.replace(/_/g, '-') ?? '')
    return `Journals/${day ?? safeName(journal[1] ?? '')}.md`
  }

  const page = /^pages\/(.+)$/i.exec(path)
  const rest = page ? (page[1] ?? path) : path

  // A page whose name held a slash is written with three underscores, since the
  // name has to be a file name: `a___b.md` is the page `a/b`, which is a folder
  // and a note here. Every part is argued with on its own, so the folders an
  // export arranged stay folders.
  return rest
    .split('/')
    .flatMap((one) => one.split('___'))
    .map((one) => safeName(one))
    .join('/')
}

/** What every block that carries an id says, so a reference to it can be written
 *  out in full. */
async function blocksById(sources: readonly Source[]): Promise<Map<string, string>> {
  const found = new Map<string, string>()

  for (const source of sources) {
    if (!/\.(md|markdown)$/i.test(source.path)) continue

    const lines = (await source.text()).split('\n')
    for (const [at, line] of lines.entries()) {
      const id = BLOCK_ID.exec(line)?.[1]?.toLowerCase()
      if (!id) continue

      // The block is the line above the id, which is where Logseq writes it.
      for (let back = at - 1; back >= 0; back -= 1) {
        const said = (lines[back] ?? '').replace(/^\s*-\s+/, '').trim()
        if (!said || PROPERTY.test(said)) continue
        found.set(id, said)
        break
      }
    }
  }

  return found
}

/** A note's properties, its words, and how many references were written out. */
export function logseqNote(
  text: string,
  blocks: ReadonlyMap<string, string> = new Map(),
): { body: string; meta: Meta; flattened: number } {
  const lines = text.split('\n')
  const said: [string, string][] = []
  let at = 0

  // The properties are the first lines of the file, before anything else.
  while (at < lines.length) {
    const line = lines[at] ?? ''
    if (!line.trim()) {
      at += 1
      continue
    }

    const found = PROPERTY.exec(line)
    if (!found) break

    said.push([found[1] ?? '', (found[2] ?? '').trim()])
    at += 1
  }

  const meta: Meta = {}
  const extra: [string, string][] = []
  const tags: string[] = []

  for (const [name, value] of said) {
    if (!value) continue

    if (/^tags?$/i.test(name)) {
      tags.push(...value.split(',').map((one) => one.trim()))
      continue
    }

    if (/^(created-at|date)$/i.test(name)) {
      const day = dayOf(value)
      if (day) {
        meta.date ??= day
        continue
      }
    }

    if (/^(id|collapsed|heading)$/i.test(name)) continue

    extra.push([name, value])
  }

  if (tags.length) meta.tags = tags
  if (extra.length) meta.extra = extra

  let flattened = 0
  const body = lines
    .slice(at)
    .filter((line) => !BLOCK_ID.test(line))
    .map((line) =>
      line
        .replace(MARKER, (_whole, indent: string, word: string) =>
          word === 'DONE' ? `${indent}- [x] ` : `${indent}- [ ] `,
        )
        .replace(REFERENCE, (whole, id: string) => {
          const block = blocks.get(id.toLowerCase())
          if (!block) return whole
          flattened += 1
          return block
        }),
    )
    .join('\n')

  return { body, meta, flattened }
}
