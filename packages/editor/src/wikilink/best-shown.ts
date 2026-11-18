import type { Completion } from '@codemirror/autocomplete'
import { foldName } from '@orden/markdown/links'

function closeness(label: string, needle: string): number {
  const folded = foldName(label.replace(/^[#^]/, ''))
  if (folded === needle) return 0
  if (folded.startsWith(needle)) return 1
  return folded.includes(needle) ? 2 : 3
}

export function bestShown(
  rows: readonly Completion[],
  needle: string,
  most: number,
): { rows: Completion[]; all: boolean } {
  const ranked = needle
    ? rows
        .map((row, at) => ({ row, at, close: closeness(row.label, needle) }))
        .sort((one, other) => one.close - other.close || one.at - other.at)
        .map((one) => one.row)
    : [...rows]
  return { rows: ranked.slice(0, most), all: rows.length <= most }
}
