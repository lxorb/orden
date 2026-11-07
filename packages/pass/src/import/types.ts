import type { Content } from '../types'

export interface ImportedItem {
  content: Content
  created: number | null
  modified: number | null
  pinned: boolean
  trashed: boolean
  folder: string | null
}

export interface ImportedVault {
  name: string
  items: ImportedItem[]
}

export interface Skipped {
  reason: string
  title: string
}

export interface Imported {
  vaults: ImportedVault[]
  skipped: Skipped[]
}
