import type { QuickFields } from '@orden/bases/language'

export { type Entry, linesOf, placeIn } from '@orden/bases/tasks'

export interface Prefill {
  tags?: string[]
  due?: string
  text?: string
  description?: string
  fields?: Partial<QuickFields>
  escaped?: { from: number; to: number }[]
  keep?: { from: number; to: number }[]
}
