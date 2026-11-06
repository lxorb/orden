export interface Marks {
  heading: boolean
  bold: boolean
  italic: boolean
  strike: boolean
  highlight: boolean
  code: boolean
  fence: boolean
  link: boolean
}

export const MARKS: Marks = {
  heading: false,
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
  code: true,
  fence: true,
  link: false,
}

export type Compaction = 'none' | 'collapse' | 'aggressive'

export const COMPACTIONS: readonly Compaction[] = ['none', 'collapse', 'aggressive']

export const DEFAULT_COMPACTION: Compaction = 'collapse'

export function isCompaction(value: unknown): value is Compaction {
  return typeof value === 'string' && (COMPACTIONS as readonly string[]).includes(value)
}
