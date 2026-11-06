import type { AttachmentFolder } from '../attachments'
import type { LinkFormat } from '../link-format'
import type { FormatId } from './plan'
import type { Source } from './sources'

export interface Carried {
  linkFormat?: LinkFormat
  hardBreaks?: boolean
  attachments?: AttachmentFolder
  vim?: boolean
  quietMarks?: boolean
  keys?: 'obsidian' | 'notion'
}

export const NOTION: Carried = {
  quietMarks: true,
  hardBreaks: true,
  keys: 'notion',
}

export async function carriedBy(
  format: FormatId,
  sources: readonly Source[],
): Promise<Carried | null> {
  if (format === 'obsidian') {
    const { obsidianCarries } = await import('./obsidian')
    return obsidianCarries(sources)
  }

  return format === 'notion' ? NOTION : null
}
