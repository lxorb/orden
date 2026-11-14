import type { DocKey, NotePath, SpaceId } from './ids'
import type { TabKind } from './shell'

export interface NoteContent {
  readonly key: DocKey
  readonly kind: TabKind
  readonly path: NotePath | null
  readonly name: string
  readonly text: string
  readonly dirty: boolean
  readonly shared: string | null
  readonly home: SpaceId | null
}

export interface NoteStart {
  readonly kind: TabKind
  readonly path: NotePath | null
  readonly name: string
  readonly text: string
  readonly dirty: boolean
  readonly shared?: string | null
  readonly home?: SpaceId | null
}

export interface Heading {
  readonly level: number
  readonly text: string
  readonly line: number
}

export interface HeldEditPort {
  readonly flush: () => void
}

export interface NotePorts {
  readonly 'edits.held': HeldEditPort
}

export const UNTITLED = 'Untitled'

export function unixLines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}
