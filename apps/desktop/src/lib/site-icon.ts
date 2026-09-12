/** The space's mark as a file a browser can draw in a tab.
 *
 *  Why here and not on the server: a space wears an emoji, a Lucide stroke or a
 *  finished drawing out of a set this app fetches when it is first asked for one.
 *  The side that has the sets is the side that can render one, and a Worker that
 *  bundled every set to answer with half a kilobyte would start slower for every
 *  request there is. So the app draws it once, the account keeps the drawing, and
 *  the site serves it at `/favicon.svg`.
 *
 *  Read off the mark already on screen rather than drawn a second time: the badge
 *  in the sheet is the same mark the rail draws, out of the one component that
 *  knows all three kinds of icon. A second renderer here would be a second answer
 *  to "what does this space look like". See SpaceMark.svelte and Icon.svelte.
 *
 *  An SVG and nothing else. Every browser that is still shipped draws an SVG
 *  favicon; the PNG that one or two platforms would rather have needs a
 *  rasteriser, and a tab icon is not worth one. */

/** The box, so the mark has the same corner radius as the badge it came from. */
const SIZE = 32
const RADIUS = 7
/** Where the mark sits inside that box, leaving it a little air. */
const INSET = 5

/** The ground the mark is drawn on. Not the accent: a tab icon is looked at
 *  next to a dozen others, and a plain dark square with a light mark on it is
 *  legible at sixteen pixels in either theme. */
const GROUND = '#17161c'
const INK = '#f4f3f8'

function opens(svg: string, attribute: string): string | null {
  return new RegExp(`\\b${attribute}="([^"]*)"`).exec(svg)?.[1] ?? null
}

/** One space's icon as an SVG document, from the element the app has already
 *  drawn it into. Null where there is nothing to draw, which is a space wearing
 *  its own first letter: the site draws that itself, out of the name it already
 *  has. */
export function siteIcon(mark: Element | null): string | null {
  if (!mark) return null

  const drawn = mark.querySelector('svg')
  if (drawn) {
    // The inner markup as it stands, inside a viewport of its own, so that the
    // stroke widths and the coordinates it was drawn with still mean what they
    // meant. `currentColor` has nothing to inherit from in a file, so the mark's
    // own colour is written in.
    const box = opens(drawn.outerHTML, 'viewBox') ?? '0 0 24 24'
    const stroke = opens(drawn.outerHTML, 'stroke-width') ?? '1.7'
    const inner = drawn.innerHTML.replace(/currentColor/g, INK)
    const room = SIZE - INSET * 2

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
      `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${GROUND}"/>` +
      `<svg viewBox="${box}" x="${INSET}" y="${INSET}" width="${room}" height="${room}"` +
      ` fill="none" stroke="${INK}" stroke-width="${stroke}"` +
      ` stroke-linecap="round" stroke-linejoin="round">${inner}</svg>` +
      `</svg>`
    )
  }

  const said = (mark.textContent ?? '').trim()
  if (!said) return null

  // An emoji, or the letter a space wears until it has an icon: both are type,
  // and both are set on the same ground the strokes are, so a site's tab icon is
  // one thing however the space is marked. The Worker draws the letter the same
  // way for a site whose app has never said; see blog.ts.
  const letter = /^[\p{L}\p{N}]$/u.test(said)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${GROUND}"/>` +
    `<text x="${SIZE / 2}" y="${SIZE - (letter ? 9 : 7)}" text-anchor="middle"` +
    `${letter ? ` fill="${INK}" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="600" font-size="19"` : ' font-size="24"'}` +
    `>${said}</text></svg>`
  )
}
