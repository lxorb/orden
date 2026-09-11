/** Converting another app's spellings in notes that are already here.
 *
 *  The import reads an export, which is one moment. This is for the notes that
 *  arrived some other way: a folder copied across, a space synced out of another
 *  app, a note somebody pasted. Same rewrites, run on demand.
 *
 *  Two of them, which are the two that actually break something:
 *
 *  A Bear tag that closes itself - `#two words#` - is not a tag anywhere else, so
 *  it becomes `#two-words`, which is one. Never inside a fence, where a hash is
 *  code.
 *
 *  A Zettelkasten id link - `[[202201011200]]` - points at a note by the
 *  timestamp it was made at. nib names such a note `202201011200 The title.md`,
 *  the way Obsidian's own unique-note command does, and a link to the bare id then
 *  points at nothing. So where a note's name begins with that id, the link is
 *  written out in full and starts working.
 *
 *  Roam's `[[page]]` is deliberately not in the list: it is already a wikilink and
 *  already means what it says here, so there is nothing to convert. Which is worth
 *  writing down, because it is the one people ask about. */

/** A tag that closes itself.
 *
 *  Written strictly, because the loose version eats whole sentences: with two
 *  ordinary tags in one line, `#work and #home` reads as one closed tag holding
 *  "work and ". So the hash has to open at the start of a line or after a space,
 *  what is inside may not begin or end with a space, the closing hash may not be
 *  followed by a word character, and nothing inside may be a backtick or a
 *  bracket, since those belong to code and to links rather than to a tag. */
const CLOSED_TAG = /(^|[\s(])#([^\s#`[\]\n]|[^\s#`[\]\n][^#`[\]\n]{0,58}[^\s#`[\]\n])#(?![\w#])/g

/** A wikilink whose whole target is a timestamp: twelve digits or fourteen, which
 *  are the two shapes a unique note's name is written in. */
const ID_LINK = /\[\[(\d{12,14})((\|[^\]\n]*)?)\]\]/g

/** The digits a note's own name begins with, which is what an id link names. */
const ID_NAME = /^(\d{12,14})(?=[\s\-_]|$)/

export interface Converted {
  text: string
  /** How many things were rewritten, for the count the reader is shown before
   *  any of it is written. */
  changes: number
}

/** Both rewrites, and how many there were.
 *
 *  `names` is every note name in the space, which is how an id link finds the note
 *  it means. Without it the tags are still converted, so a single note can be
 *  converted without reading the space. */
export function converted(text: string, names: readonly string[] = []): Converted {
  const tagged = convertTags(text)
  const linked = convertIdLinks(tagged.text, idsIn(names))

  return { text: linked.text, changes: tagged.changes + linked.changes }
}

/** Bear's closed tags, leaving every fenced block exactly as written. */
export function convertTags(text: string): Converted {
  let fenced = false
  let changes = 0

  const lines = text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return line
    }

    if (fenced) return line

    return line.replace(CLOSED_TAG, (whole, before: string, inside: string) => {
      const name = tagFrom(inside)
      // A pair of hashes around something that is not a name is words.
      if (!name) return whole

      changes += 1
      return `${before}#${name}`
    })
  })

  return { text: lines.join('\n'), changes }
}

/** A tag out of what Bear allowed inside one: no spaces, no punctuation on the
 *  ends, and the slashes kept, because a nested tag is nested in both. */
function tagFrom(inside: string): string {
  return inside
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/{2,}/g, '/')
}

/** An id link written out as the note it means. */
export function convertIdLinks(text: string, ids: ReadonlyMap<string, string>): Converted {
  if (!ids.size) return { text, changes: 0 }

  let changes = 0
  const said = text.replace(ID_LINK, (whole, id: string, shown: string) => {
    const name = ids.get(id)
    if (!name || name === id) return whole

    changes += 1
    return `[[${name}${shown}]]`
  })

  return { text: said, changes }
}

/** Which note each id names. A note whose whole name is the id needs no entry:
 *  a link to it already works. */
export function idsIn(names: readonly string[]): Map<string, string> {
  const ids = new Map<string, string>()

  for (const name of names) {
    const stem = name.replace(/\.(md|markdown)$/i, '')
    const id = ID_NAME.exec(stem)?.[1]
    if (!id || stem === id) continue
    // The first one wins, the way a link does when two notes share a name.
    if (!ids.has(id)) ids.set(id, stem)
  }

  return ids
}
