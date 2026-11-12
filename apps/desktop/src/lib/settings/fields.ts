import type { IconNode } from 'lucide'

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

interface Common {
  label: string
  words?: string[]
  hint: string
  icon?: IconNode
  key?: string
  member?: string
  check?: (value: string) => string | null
}

export interface SwatchOption {
  value: string
  label: string
  colour: string
}

export interface PairField {
  get(): readonly [string, string]
  own(): boolean
  preview(first: string, second: string): void
  set(first: string, second: string): void
}

export interface Segment {
  value: string
  label: string
  disabled?: boolean
}

export type Field = Common &
  (
    | {
        kind: 'switch'
        initial?: boolean
        locked?: () => boolean
        get(): boolean
        set(on: boolean): void
      }
    | {
        kind: 'slider'
        min: number
        max: number
        step: number
        unit?: string
        initial?: number
        least?: () => number
        get(): number
        preview?(value: number): void
        set(value: number): void
      }
    | {
        kind: 'select'
        options: { value: string; label: string; note?: string }[]
        open?: boolean
        initial?: string
        get(): string
        set(value: string): void
      }
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
    | {
        kind: 'text'
        placeholder: string
        live?: boolean
        font?: { mono: boolean }
        initial?: string
        get(): string
        set(value: string): void
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

type PaneId =
  | 'general'
  | 'editor'
  | 'kinds'
  | 'spelling'
  | 'markdown'
  | 'appearance'
  | 'experimental'
  | 'export'

export interface Pane {
  id: PaneId
  label: string
  groups: Group[]
}
