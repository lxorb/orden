import { ICON_ATTRIBUTES, type IconParts } from '@orden/markdown/icons'

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
