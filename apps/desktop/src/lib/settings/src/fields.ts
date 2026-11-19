import type { SettingCommon, SettingControl } from '@orden/contracts'
import type { IconNode } from 'lucide'
import type { PairField, SwatchOption } from '../../ui-controls/src/api'

export interface PictureSide {
  label: string
  current: boolean
  picture(): string
  own(): boolean
  focus(): [number, number]
  choose(): void
  remove(): void
  place(x: number, y: number, kept: boolean): void
}

interface Common extends SettingCommon {
  icon?: IconNode
}

export interface Segment {
  value: string
  label: string
  disabled?: boolean
}

export type { PairField, SwatchOption }

export type Field = Common &
  (
    | SettingControl
    | {
        kind: 'segmented'
        options: Segment[]
        initial?: string
        get(): string
        set(value: string): void
      }
    | {
        kind: 'swatches'
        options: SwatchOption[]
        initial?: string
        get(): string
        set(value: string): void
        pair?: PairField
      }
    | {
        kind: 'picture'
        initial?: string
        get(): string
        set(value: string): void
        sides: PictureSide[]
      }
    | {
        kind: 'value'
        initial?: undefined
        get(): string
        does: string
        press(): void
      }
  )

export interface Caption {
  text: string
  url?: string
}

export interface Group {
  title: string
  caption?: Caption
  fields: Field[]
}

type PaneId = 'general' | 'editor' | 'kinds' | 'spelling' | 'markdown' | 'appearance' | 'experimental' | 'export'

export interface Pane {
  id: PaneId
  label: string
  groups: Group[]
}
