/** Which drawing of the emoji's outlines draws an emoji (#1097), read the same way by the
 *  app and by the build that fills in what the set does not draw (emoji-outlines.ts). One
 *  module of plain functions, so the build can import it without the app around it. */

/** An emoji as Iconify's `chars.json` keys it: its code points in hex, joined by dashes,
 *  each at least four digits. The file writes `#️⃣` as `0023-20e3`; read as `23-20e3` it
 *  found nothing. */
function codePoints(emoji: string): string {
  // Code points on purpose: the file keys a family by each of its parts.
  return Array.from(emoji, (one) => (one.codePointAt(0) ?? 0).toString(16).padStart(4, '0')).join(
    '-',
  )
}

/** An emoji without the selector that asks a platform to draw it in colour rather
 *  than as a glyph. The two lists disagree about it on 142 of them - ❤️ against ❤ -
 *  and it is not a character anybody searches by. */
export function plain(emoji: string): string {
  return emoji.replace(/️/g, '')
}

/** The name an emoji's outline goes by: the one the set files its character under, else
 *  its Unicode slug, which is also the name a drawing filled in for it is given. */
export function outlineName(
  emoji: string,
  slug: string,
  chars: Readonly<Record<string, string>>,
): string {
  return chars[codePoints(emoji)] ?? chars[codePoints(plain(emoji))] ?? slug.replace(/_/g, '-')
}

/** The set's drawings that fill their whole box rather than outline a picture: 😶‍🌫️ is a
 *  face behind clouds drawn to every edge, which at the size of a cell is a square of
 *  noise. Drawn again from Noto like an emoji the set lacks; the picker's drive holds every
 *  drawing to its box (test/e2e/icon-outlines.py). */
export const FILLS_ITS_BOX: ReadonlySet<string> = new Set(['face-in-clouds'])
