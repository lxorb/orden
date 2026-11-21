import { type Meta, keptText, noteText } from './meta'
import type { FormatId, ImportPlan, Planned, Trouble } from './plan'
import { troubleOf } from './trouble'
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
export async function folderPlan(sources: readonly Source[], options: FolderOptions): Promise<ImportPlan> {
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
  const failed: Trouble[] = []
  for (const one of placed) {
    try {
      written.push(await plannedOf(one, files, renamed))
    } catch (error) {
      failed.push({ path: one.source.path, why: troubleOf(error, one.source.path) })
    }
  }
  return { format: options.format, files: written, lost: [...(options.lost ?? [])], failed }
}
async function plannedOf(
  one: { source: Source; to: string; read: Placement['read'] },
  files: ExportFiles,
  renamed: ReadonlyMap<string, string>,
): Promise<Planned> {
  if (!one.read) {
    const bytes = await one.source.bytes()
    const kept = renamed.size && isCanvas(one.to) ? canvasFollowed(bytes, renamed) : bytes
    return { kind: 'file', path: one.to, bytes: kept, ...timesOf(one.source) }
  }
  const said = await one.read(await one.source.text(), one.source)
  const body = rewriteLinks(said.text, { was: one.source.path, now: one.to }, files.find, files.reaches)
  return {
    kind: 'note',
    path: one.to,
    text: said.kept ? keptText(body) : noteText(said.title ?? null, body, said.meta ?? {}, said.own),
    ...timesOf(one.source),
  }
}
const timesOf = (source: Source) => (source.times ? { times: source.times } : {})
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
