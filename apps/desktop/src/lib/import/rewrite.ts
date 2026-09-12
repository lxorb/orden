/** Making the links in an imported note point at the notes that arrived with it.
 *
 *  Every one of these exports writes links its own way and all of them break on
 *  the way in, because the import renames things: Notion's id comes off the end
 *  of every file, a title that held a slash loses it, and two notes called the
 *  same thing are stepped apart.
 *
 *  What a link becomes:
 *
 *  A link to another note becomes a wikilink. That is nib's own way of pointing
 *  at a note, and it is the one that survives the reader renaming it afterwards,
 *  which a path does not. It is also what the graph, the backlinks and the
 *  unlinked mentions read.
 *
 *  A link to anything else - a picture, a paper, a spreadsheet - stays a markdown
 *  link with a relative path, which is what the app itself writes when a picture
 *  is pasted, and what keeps the folder readable in another editor.
 *
 *  A link to something that was not in the export is left exactly as it was. An
 *  address into the app it came from is a fact about where the note used to live,
 *  and rewriting it to nothing would lose that. */

import { linkTo } from '../composer'
import { folderOf, isMarkdownPath, relativePath } from '../space-paths'

/** Where a link points, once the import has decided where things go. */
export interface Found {
  /** The path inside the import, relative to wherever the import lands. */
  path: string
  /** The name to write in a wikilink: the file name without its extension. */
  name: string
}

/** Answers where a link's target ended up, or null for one that was not in the
 *  export. `from` is the file the link is written in, as the export named it. */
export type Resolver = (target: string, from: string) => Found | null

/** A markdown link or embed. The target is read as everything between the
 *  brackets, because an exported path is as likely to hold a space as not, and
 *  a title after it is put back as it was. */
const LINK = /(!?)\[([^\]\n]*)\]\(([^()\n]*)\)/g

/** A wikilink, which Bear, Logseq, Roam and Obsidian all write. */
const WIKILINK = /!?\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g

export interface Rewriting {
  /** Where the note sat in the export, which is what a relative link resolves
   *  against. */
  was: string
  /** Where it is going, which is what a relative link is written from. */
  now: string
}

export function rewriteLinks(text: string, at: Rewriting, find: Resolver): string {
  const folder = folderOf(at.now)

  const linked = text.replace(LINK, (whole, bang: string, label: string, inside: string) => {
    const { target, title } = splitTarget(inside)
    if (!target || isAddress(target)) return whole

    const found = find(decoded(target), at.was)
    if (!found) return whole

    // A note is pointed at by name, so the link survives it being renamed - or in
    // the spelling the Links setting asks for, since `linkTo` is the one place in
    // the app that writes a link to a note and this is the app writing one.
    if (isMarkdownPath(found.path)) {
      return linkTo(found.name, label, { path: found.path, from: at.now, embed: bang === '!' })
    }

    const path = relativePath(folder, found.path)
    return `${bang}[${label}](${encodeTarget(path)}${title})`
  })

  // `shown` is the second group, which a link with no `|` in it does not have: the
  // replacer is handed `undefined` there whatever the types say. Through `linkTo`
  // as well, so an import writes one spelling throughout rather than keeping the
  // exporting app's wherever it happened to match nib's.
  return linked.replace(WIKILINK, (whole, target: string, shown: string | undefined) => {
    const found = find(decoded(target.trim()), at.was)
    if (!found) return whole

    return linkTo(found.name, shown?.slice(1) ?? null, {
      path: found.path,
      from: at.now,
      embed: whole.startsWith('!'),
    })
  })
}

/** The target and the title inside a link's brackets, told apart the way every
 *  markdown reader does: the title is quoted and comes last. */
function splitTarget(inside: string): { target: string; title: string } {
  const said = inside.trim()
  const quoted = /\s+("[^"]*"|'[^']*')$/.exec(said)
  const target = quoted ? said.slice(0, quoted.index).trim() : said
  const title = quoted ? ` ${quoted[1] ?? ''}` : ''

  return { target: target.replace(/^<|>$/g, ''), title }
}

/** Whether this points somewhere else entirely, in which case it is left alone:
 *  a web address, a mail address, or a heading inside this very note. */
function isAddress(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')
}

/** A path out of what a link wrote, with the percent encoding every exporter
 *  uses for spaces undone. A target that is not valid encoding is its own
 *  answer rather than an error. */
function decoded(target: string): string {
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

/** A space encoded again on the way out, and nothing else: a reader who opens
 *  the note sees the file name they would see in the file list. */
function encodeTarget(path: string): string {
  return path.replace(/ /g, '%20')
}

/** Finding a link's target among the files an export held.
 *
 *  Three tries, in the order the exports need them: the path as written from the
 *  note's own folder, the same path from the top of the export, and finally the
 *  bare file name anywhere in the export. The last is what Obsidian, Bear and
 *  Logseq all rely on, since none of them writes a path at all. */
export class ExportFiles {
  /** Every file in the export, by its lowercased export path. */
  private readonly byPath = new Map<string, Found>()

  /** The same, by bare name, for the shortest-path links. A name two files share
   *  answers with the first, which is what any reader of those spaces does. */
  private readonly byName = new Map<string, Found>()

  add(was: string, found: Found) {
    this.byPath.set(was.toLowerCase(), found)

    const name = was.split('/').pop()?.toLowerCase() ?? was
    if (!this.byName.has(name)) this.byName.set(name, found)

    // A wikilink writes no extension, so a note answers to its stem as well.
    const stem = name.replace(/\.[^.]+$/, '')
    if (stem !== name && !this.byName.has(stem)) this.byName.set(stem, found)
  }

  /** The resolver `rewriteLinks` asks. */
  readonly find: Resolver = (target, from) => {
    const cleaned = target.replace(/^\.\//, '').replace(/#.*$/, '').replace(/\/+$/, '')
    if (!cleaned) return null

    const here = folderOf(from)
    const tries = [joined(here, cleaned), cleaned]

    for (const one of tries) {
      const found = this.byPath.get(one.toLowerCase())
      if (found) return found
    }

    const name = cleaned.split('/').pop()?.toLowerCase() ?? cleaned
    return this.byName.get(name) ?? this.byName.get(`${name}.md`) ?? null
  }
}

/** Two paths joined, with `..` resolved, all inside the export. */
function joined(folder: string, relative: string): string {
  const parts = folder ? folder.split('/') : []

  for (const part of relative.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }

  return parts.join('/')
}
