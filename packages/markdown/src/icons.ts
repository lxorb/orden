import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Play from 'lucide/dist/esm/icons/play.mjs'
import Shapes from 'lucide/dist/esm/icons/shapes.mjs'

export type IconParts = readonly (readonly [
  string,
  Readonly<Record<string, string | number | undefined>>,
])[]

export const ICON_ATTRIBUTES: Readonly<Record<string, string>> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.9',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
}

export const CHEVRON: IconParts = ChevronRight

export const DOCUMENT: IconParts = FileText
export const PLANE: IconParts = Shapes

export const PLAY: IconParts = Play
export const OPEN: IconParts = ExternalLink

export const MARKS: Readonly<Record<'play' | 'open', IconParts>> = { play: PLAY, open: OPEN }

function attributes(written: Readonly<Record<string, string | number | undefined>>): string {
  return Object.entries(written)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${String(value)}"`)
    .join('')
}

export function iconMarkup(parts: IconParts, className: string): string {
  const dress = attributes({ ...ICON_ATTRIBUTES, class: className })
  const drawn = parts.map(([tag, own]) => `<${tag}${attributes(own)} />`).join('')
  return `<svg${dress}>${drawn}</svg>`
}
