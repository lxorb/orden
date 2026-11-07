import type { Dictionary } from '../i18n.svelte'

const KEYS: readonly string[] = ['orden-even-catalogue-keys']

export const KEYS_MARK = 'orden-even-catalogue-keys'

export function rowsOf(
  column: Dictionary | readonly (Dictionary[string] | undefined)[],
): Dictionary {
  if (!Array.isArray(column)) return column as Dictionary

  const rows: Dictionary = {}
  column.forEach((row: Dictionary[string] | undefined, at) => {
    const english = KEYS[at]
    if (english !== undefined && row !== undefined) rows[english] = row
  })

  return rows
}
