/** What a page is, in one short string.
 *
 *  One thing stands on it: an edit re-sends only the pages whose hash moved,
 *  which is what keeps a keystroke off the radio. So the hash has to cover
 *  everything the panel would show and nothing that it would not. */

/** FNV-1a over the string, in 32 bits, as hex. Not a cryptographic hash and
 *  nothing here needs one: it stands between a page and the words already on the
 *  glass, both of which this process made. Two pages of a note colliding would
 *  leave the wrong page up, and at 32 bits over the few dozen pages of a note
 *  that is far rarer than the note being edited under us. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
