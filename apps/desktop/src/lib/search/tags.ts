/** Every `#tag` a note uses, once per use.
 *
 *  One rule, three readers: the tag list under an empty search field, the
 *  `tag:` operator, and the browser's stand-in for `space_tags`. The Rust side
 *  keeps the twin of this in search.rs, and the tests hold the two to the same
 *  answers.
 *
 *  A heading is not a tag: it has a space after the hash and a tag never does.
 *  A tag starts a word, and its first character is a letter, which is what
 *  rules out `#42`. */

const TAG = /(^|[\s(])#(\p{L}[\p{L}\p{N}\-_/]*)/gu

const FENCE = /^\s*(```|~~~)/

export function tagsIn(body: string): string[] {
  const found: string[] = []
  let fenced = false

  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    for (const match of line.matchAll(TAG)) {
      const name = match[2]
      if (name !== undefined) found.push(`#${name}`)
    }
  }

  return found
}
