/** What a page is, in one short string.
 *
 *  Two things stand on it. A page's bitmap is drawn once and kept under its
 *  hash, so a note scrolled back through costs nothing; and an edit re-sends
 *  only the pages whose hash moved, which is what keeps a keystroke off the
 *  radio. So the hash has to cover everything that decides a pixel and nothing
 *  that does not: the words, the styles, the positions, the greys. */

import type { Line } from './layout'

/** FNV-1a over the string, in 32 bits, as hex. Not a cryptographic hash and
 *  nothing here needs one: it stands between a page and its own bitmap, both of
 *  which this process made. Two pages of a note colliding would show the wrong
 *  picture, and at 32 bits over the few dozen pages of a note that is far
 *  rarer than the note being edited under us. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** The same, over bytes. What tells one container's pixels from another's, so a
 *  page turn that leaves a quadrant alone does not send it again. */
export function hashOfBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Everything about a line that reaches the panel, as text. */
function lineKey(line: Line): string {
  const runs = line.placed.map(({ run, x, width }) => {
    const { style } = run
    const face = `${style.family}${style.size}${style.weight[0]}${style.slant[0]}${style.grey}`
    const marks = `${style.underline ? 'u' : ''}${style.strike ? 's' : ''}`
    const extra = [
      run.over ?? '',
      run.box ?? '',
      run.rise ?? '',
      run.math ? `m${run.math.tex}${run.math.display ? 'd' : ''}` : '',
      run.picture ? `p${run.picture.source}` : '',
    ].join('|')
    return `${x},${width},${face},${marks},${extra},${run.text}`
  })

  const fills = line.fills.map((one) => `${one.x},${one.y},${one.width},${one.height},${one.grey}`)
  return [line.height, line.baseline, ...runs, ...fills].join(';')
}

export function hashOfLines(lines: readonly Line[], tops: readonly number[]): string {
  return hashOf(lines.map((line, at) => `${tops[at] ?? 0}:${lineKey(line)}`).join('\n'))
}
