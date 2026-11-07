export const SELECTED = 'data-orden-selection'

export function isSnapshot(html: string): boolean {
  return /^\s*<!doctype html/i.test(html)
}
