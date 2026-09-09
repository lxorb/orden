/** An icon as elements.
 *
 *  The parts and the dressing both come from @nib/markdown/icons, so what the
 *  editor builds is the same drawing the renderer writes as markup rather than a
 *  second one that looks like it. Here, once, because three widgets draw one: the
 *  fold chevron, a callout's mark, and the card an embedded file becomes. */

import { ICON_ATTRIBUTES, type IconParts } from '@nib/markdown/icons'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function iconElement(parts: IconParts, className?: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const [name, value] of Object.entries(ICON_ATTRIBUTES)) svg.setAttribute(name, value)
  if (className) svg.setAttribute('class', className)

  for (const [tag, attributes] of parts) {
    const child = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== undefined) child.setAttribute(name, String(value))
    }
    svg.append(child)
  }

  return svg
}
