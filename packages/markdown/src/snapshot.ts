export const SELECTED = 'data-nib-selection'

export function isSnapshot(html: string): boolean {
  return /^\s*<!doctype html/i.test(html)
}
