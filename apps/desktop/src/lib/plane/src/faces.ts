import type { CanvasNode } from '@orden/markdown/canvas'
import { fileShown, pageOfFile } from './render'

export type Faces = ReadonlyMap<string, string>

export const NO_FACES: Faces = new Map()

export function faceOf(node: CanvasNode): string {
  return node.type === 'file' ? `${String(pageOfFile(node))}\n${node.file}` : ''
}

export async function pdfFaces(
  nodes: readonly CanvasNode[],
  at: { note: string | null; root: string | null; shared?: string | null },
): Promise<Faces> {
  const wanted = new Map(
    nodes.flatMap((node) =>
      node.type === 'file' && fileShown(node.file) === 'pdf'
        ? [[faceOf(node), { file: node.file, page: pageOfFile(node) }] as const]
        : [],
    ),
  )
  if (!wanted.size) return NO_FACES

  const { paperPicture, holdPaper } = await import('../../pdf/src/api')
  const faces = new Map<string, string>()
  for (const [key, { file, page }] of wanted) {
    const release = holdPaper({ ...at, file })
    try {
      const face = await paperPicture({ ...at, file }, page).catch(() => null)
      if (face) faces.set(key, face)
    } finally {
      release()
    }
  }
  return faces
}
