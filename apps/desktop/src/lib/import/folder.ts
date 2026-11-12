import type { Meta } from './meta'
import { keptText, noteText } from './meta'
import type { FormatId, ImportPlan, Planned } from './plan'
import { canvasFollowed, ExportFiles, isCanvas, rewriteLinks } from './rewrite'
import type { Source } from './sources'

export { isJunk } from './names'

interface Written {
  text: string
  title?: string | null
  meta?: Meta
  kept?: boolean
  own?: boolean
}

interface Placement {
  to: string | null
  read?: (text: string, source: Source) => Promise<Written> | Written
}

export interface FolderOptions {
  format: FormatId
  place: (source: Source) => Placement
  lost?: readonly string[]
}

export async function folderPlan(
  sources: readonly Source[],
  options: FolderOptions,
): Promise<ImportPlan> {
  const placed: { source: Source; to: string; read: Placement['read'] }[] = []
  const files = new ExportFiles()
  const renamed = new Map<string, string>()

  for (const source of sources) {
    const placement = options.place(source)
    if (!placement.to) continue

    placed.push({ source, to: placement.to, read: placement.read })
    files.add(source.path, { path: placement.to, name: nameFor(placement.to) })
    if (placement.to !== source.path) renamed.set(source.path, placement.to)
  }

  const written: Planned[] = []

  for (const one of placed) {
    if (!one.read) {
      const bytes = await one.source.bytes()
      const kept = renamed.size && isCanvas(one.to) ? canvasFollowed(bytes, renamed) : bytes
      written.push({ kind: 'file', path: one.to, bytes: kept })
      continue
    }

    const said = await one.read(await one.source.text(), one.source)
    const body = rewriteLinks(
      said.text,
      { was: one.source.path, now: one.to },
      files.find,
      files.reaches,
    )
    written.push({
      kind: 'note',
      path: one.to,
      text: said.kept
        ? keptText(body)
        : noteText(said.title ?? null, body, said.meta ?? {}, said.own),
    })
  }

  return { format: options.format, files: written, lost: [...(options.lost ?? [])] }
}

function nameFor(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
}

export function isNoteFile(path: string): boolean {
  return /\.(md|markdown|mdown|mkd|txt)$/i.test(path)
}

export function isHidden(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'))
}
