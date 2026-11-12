import { textAtMost } from './body'

const RESOLVER = 'https://cloudflare-dns.com/dns-query'

const TIMEOUT = 5_000

const LONGEST = 32_000

const MOST_STRINGS = 40

export type Txt = { asked: true; values: string[] } | { asked: false }

interface Answer {
  type?: number
  data?: string
}

function unquote(data: string): string {
  const pieces = data.match(/"((?:[^"\\]|\\.)*)"/g)
  if (!pieces) return data.trim()

  return pieces
    .map((piece) => piece.slice(1, -1).replace(/\\(.)/g, '$1'))
    .join('')
    .trim()
}

export async function txtAt(name: string): Promise<Txt> {
  try {
    const response = await fetch(`${RESOLVER}?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) return { asked: false }

    const text = await textAtMost(response, LONGEST)
    if (text === null) return { asked: false }

    const reply = JSON.parse(text) as { Status?: number; Answer?: Answer[] }

    if (reply.Status !== 0 && reply.Status !== 3) return { asked: false }

    const answers = Array.isArray(reply.Answer) ? reply.Answer : []
    const values = answers
      .filter((one) => one.type === 16 && typeof one.data === 'string')
      .slice(0, MOST_STRINGS)
      .map((one) => unquote(one.data ?? ''))

    return { asked: true, values }
  } catch {
    return { asked: false }
  }
}
