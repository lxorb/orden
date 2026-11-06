import type { Typed } from './types'

export function sizeOf(typed: readonly Typed[]): { cols: number; rows: number } | null {
  let latest: Typed | null = null
  for (const one of typed) {
    if (!(one.cols >= 1 && one.rows >= 1)) continue
    if (!latest || one.at >= latest.at) latest = one
  }
  return latest ? { cols: latest.cols, rows: latest.rows } : null
}
