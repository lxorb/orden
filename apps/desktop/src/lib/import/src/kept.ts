export interface Kept {
  id: string
  space: string
  from: string | null
  label: string
  finished: boolean
  made: boolean
}
export const keptText = (kept: Kept): string => JSON.stringify(kept)
export function readKept(text: string): Kept | null {
  try {
    const said: unknown = JSON.parse(text)
    if (!said || typeof said !== 'object') return null
    const one = said as Record<string, unknown>
    if (typeof one.id !== 'string' || typeof one.space !== 'string' || typeof one.label !== 'string') return null
    return {
      id: one.id,
      space: one.space,
      label: one.label,
      from: typeof one.from === 'string' ? one.from : null,
      finished: one.finished === true,
      made: one.made !== false,
    }
  } catch {
    return null
  }
}
