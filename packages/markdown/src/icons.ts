/** The few Lucide icons that are part of what a note *is* rather than part of
 *  the app around it: a callout's own mark, and the chevron that says a block
 *  can be folded.
 *
 *  Here rather than in the app because three different things draw them - the
 *  renderer writes HTML, the editor builds DOM, the Worker publishes a page -
 *  and a chevron drawn twice is two chevrons that drift apart. Data and not a
 *  drawing, because a Worker has no `document`.
 *
 *  One file each from Lucide, so nothing that touches this package pulls in the
 *  whole set. */

import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'

/** An icon as data: the elements it is drawn from, in order. Lucide's own
 *  shape, restated without its name so nothing has to import the library to
 *  read one. */
export type IconParts = readonly (readonly [
  string,
  Readonly<Record<string, string | number | undefined>>,
])[]

/** How an icon's own `<svg>` is dressed, so markup written here and elements
 *  built elsewhere are the same drawing. */
export const ICON_ATTRIBUTES: Readonly<Record<string, string>> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.9',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
}

/** The mark that says there is more behind this: pointing at what it holds shut,
 *  and turned by the stylesheet to point down at what it has let out. The
 *  editor draws the same one in the margin beside anything that folds. */
export const CHEVRON: IconParts = ChevronRight

function attributes(written: Readonly<Record<string, string | number | undefined>>): string {
  return Object.entries(written)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${String(value)}"`)
    .join('')
}

/** An icon as markup: one `<svg>`, its children self-closed.
 *
 *  Self-closed because an EPUB is read by an XML parser, which takes a `<path>`
 *  as an element left open and refuses the book. */
export function iconMarkup(parts: IconParts, className: string): string {
  const dress = attributes({ ...ICON_ATTRIBUTES, class: className })
  const drawn = parts.map(([tag, own]) => `<${tag}${attributes(own)} />`).join('')
  return `<svg${dress}>${drawn}</svg>`
}
