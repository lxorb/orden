import type { Scheme } from '../theme.svelte'

export interface OwnPair {
  accepts(held: string): boolean
  colours(held: string, scheme: Scheme): readonly [string, string]
  of(first: string, second: string): string
}
