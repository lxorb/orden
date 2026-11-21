import type { FormatId } from './plan'

const BRANDS: Partial<Record<FormatId, string>> = {
  obsidian: 'obsidian',
  notion: 'notion',
  evernote: 'evernote',
  keep: 'googlekeep',
  bear: 'bear',
  logseq: 'logseq',
  roam: 'roamresearch',
  craft: 'craft',
  onenote: 'microsoftonenote',
  'apple-notes': 'apple',
  journal: 'apple',
  todoist: 'todoist',
}
export const brandOf = (format: FormatId | null): string | null => (format ? (BRANDS[format] ?? null) : null)
