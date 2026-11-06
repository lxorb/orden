export interface Stamp {
  id: string
  name: string
  author: string
  version: string
}

export const STAMP_LINE = /^\s*\/\*!\s*nib-theme\s*(\{.*?\})\s*\*\//

export function stamped(stamp: Stamp, css: string): string {
  const clean = (text: string) => text.replace(/[/*\\]/g, '').replace(/\p{Cc}/gu, '')
  const said = {
    id: clean(stamp.id),
    name: clean(stamp.name),
    author: clean(stamp.author),
    version: clean(stamp.version),
  }

  return `/*! nib-theme ${JSON.stringify(said).replace(/\//g, '\\/')} */\n${css}\n`
}

export function stampOf(css: string): Stamp | null {
  const line = STAMP_LINE.exec(css)
  if (!line?.[1]) return null

  try {
    const value: unknown = JSON.parse(line[1])
    if (typeof value !== 'object' || value === null) return null

    const { id, name, author, version } = value as Record<string, unknown>
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof author !== 'string' ||
      typeof version !== 'string'
    ) {
      return null
    }

    return { id, name, author, version }
  } catch {
    return null
  }
}
