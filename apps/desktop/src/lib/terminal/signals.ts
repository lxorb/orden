export const MOST_COPY = 1024 * 1024

export function clipboardWrite(data: string): string | null {
  const split = data.indexOf(';')
  if (split < 0) return null
  const where = data.slice(0, split)
  const payload = data.slice(split + 1)
  if (!/^[cpqs0-7]*$/.test(where) || payload === '?' || payload === '') return null
  if (payload.length > Math.ceil((MOST_COPY * 4) / 3) + 4) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.replace(/\s/g, ''))) return null
  try {
    const binary = atob(payload.replace(/\s/g, ''))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

export interface Notice {
  title: string | null
  body: string
}

const LONGEST = 256

const cut = (words: string) => words.trim().slice(0, LONGEST)

export function osc9Notice(data: string): Notice | null {
  if (/^\d+(;|$)/.test(data)) return null
  const body = cut(data)
  return body ? { title: null, body } : null
}

export function osc777Notice(data: string): Notice | null {
  const [kind, title = '', ...rest] = data.split(';')
  if (kind !== 'notify') return null
  const body = cut(rest.join(';'))
  const named = cut(title)
  if (!body && !named) return null
  return { title: named || null, body }
}
