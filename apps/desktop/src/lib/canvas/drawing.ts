import { readCanvas } from './format'
import { readPalette } from './palette'
import type { Drawing } from './picture'

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
