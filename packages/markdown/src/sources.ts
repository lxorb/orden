/** The addresses in a rendered page that point at a file of the reader's own.
 *
 *  Five things rewrite them, and every one of them used to carry its own regular
 *  expression matching `<img src="…">`: the reading view turns a path into
 *  something the webview will load, the editor's hover preview does the same, an
 *  export swaps a path for the bytes behind it, an ePub repoints one at the copy
 *  inside the book, and the picture reader collects them. Five copies of one
 *  question is five places to forget when a note learns to hold a sixth kind of
 *  file - which is what `![[clip.mp3]]` becoming a player would have been.
 *
 *  So the pattern lives here, once. A tag belongs in it when what it points at is
 *  a file some surface has to find on a disk: a picture, a recording, a film. Not
 *  an `<iframe>` - what one of those points at is a page somewhere else, and
 *  nothing here should go looking for that beside a note. */

/** Every `src` in the page that names a file, whatever element holds it. */
const SOURCE = /(<(?:img|audio|video|source)\b[^>]*?\bsrc=")([^"]*)(")/g

/** Each address the page names, once, in the order it names them. `keep` is the
 *  question each caller asks in its own way: whether it wants this one. */
export function sourcesOf(html: string, keep: (src: string) => boolean = () => true): string[] {
  const found = new Set<string>()

  for (const match of html.matchAll(SOURCE)) {
    const src = match[2] ?? ''
    if (src && keep(src)) found.add(src)
  }

  return [...found]
}

/** The same page with each address the caller answers for swapped. Returning
 *  null leaves one as it was, which is what a file that could not be read gets:
 *  a picture still pointing where it did beats one pointing nowhere. */
export function mapSources(html: string, swap: (src: string) => string | null): string {
  return html.replace(SOURCE, (whole: string, before: string, src: string, after: string) => {
    const next = swap(src)
    return next === null ? whole : `${before}${next}${after}`
  })
}
