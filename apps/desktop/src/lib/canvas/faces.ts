import type { CanvasNode } from './format'
import { fileShown } from './render'

export type Faces = ReadonlyMap<string, string>

export const NO_FACES: Faces = new Map()

export async function pdfFaces(
  nodes: readonly CanvasNode[],
  at: { note: string | null; root: string | null; shared?: string | null },
): Promise<Faces> {
  const files = new Set(
    nodes.flatMap((node) =>
      node.type === 'file' && fileShown(node.file) === 'pdf' ? [node.file] : [],
    ),
  )
  if (!files.size) return NO_FACES

  const [{ paperPicture }, { holdPaper }] = await Promise.all([
    import('../pages/raster'),
    import('../pages/paper'),
  ])
  const faces = new Map<string, string>()
  for (const file of files) {
    const release = holdPaper({ ...at, file })
    try {
      const face = await paperPicture({ ...at, file }, 1).catch(() => null)
      if (face) faces.set(file, face)
    } finally {
      release()
    }
  }
  return faces
}
