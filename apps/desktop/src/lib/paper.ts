export const PAPER_SIZES = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const

export const ORIENTATIONS = ['portrait', 'landscape'] as const

export type Paper = (typeof PAPER_SIZES)[number]

export interface PageSetup {
  paper: Paper
  orientation: (typeof ORIENTATIONS)[number]
  margin: string
  header: string
  footer: string
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'A4',
  orientation: 'portrait',
  margin: '20mm',
  header: '',
  footer: '',
}
