import type { PlaneShown } from '@orden/contracts'
import { readCanvas } from '@orden/markdown/canvas'
import { pdfFaces } from './faces'
import { readPalette } from './palette'
import { canvasSvg, type Drawing } from './picture'

export function drawingOf(open: {
  text: string
  name: string
  path: string | null
  root: string | null
  trusted?: boolean
}): Drawing {
  return {
    canvas: readCanvas(open.text),
    palette: readPalette(document.documentElement),
    path: open.path,
    root: open.root,
    name: open.name,
    trusted: open.trusted ?? false,
  }
}

export async function planeSvg(plane: PlaneShown): Promise<string | null> {
  const drawing = drawingOf(plane)
  if (!drawing.canvas.nodes.length && !drawing.canvas.ink.length) return null

  const faces = await pdfFaces(drawing.canvas.nodes, { note: plane.note, root: drawing.root })
  const holder = document.createElement('div')
  holder.innerHTML = canvasSvg(
    drawing.canvas,
    drawing.palette,
    drawing.path,
    drawing.root,
    true,
    false,
    faces,
  )

  const picture = holder.firstElementChild
  if (!(picture instanceof SVGSVGElement)) return null

  picture.removeAttribute('width')
  picture.removeAttribute('height')
  return picture.outerHTML
}
