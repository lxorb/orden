import { pageSizes } from '../../pdf/document'
import { isJunk, Names, safeParts } from './names'
import type { ImportPlan, Planned } from './plan'
import type { Source } from './sources'

export async function readPdfPages(sources: readonly Source[]): Promise<ImportPlan> {
  const files: Planned[] = []
  const lost: string[] = []
  const names = new Names()

  for (const source of sources) {
    if (isJunk(source.path)) continue

    const bytes = await source.bytes()
    const name = names.free(safeParts(source.path.split('/').pop() ?? source.path))

    const sizes = await pageSizes(bytes).catch(() => [])
    if (sizes.length) {
      files.push({ kind: 'file', path: name, bytes, pages: true })
      continue
    }

    files.push({ kind: 'file', path: name, bytes })
    lost.push(`${name} could not be read as a PDF, so it arrived as the file only.`)
  }

  return { format: 'pdf-pages', files, lost }
}
