interface HasJson {
  req: { json: <T>() => Promise<T>; header?: (name: string) => string | undefined }
}

export const MOST_BODY_BYTES = 8 * 1024 * 1024

function overlong(source: HasJson): boolean {
  const said = Number(source.req.header?.('content-length') ?? '')
  return Number.isFinite(said) && said > MOST_BODY_BYTES
}

export async function objectBody(
  source: HasJson,
): Promise<Record<string, unknown> | null | undefined> {
  if (overlong(source)) return null

  const parsed = await source.req.json<unknown>().catch(() => undefined)
  if (parsed === undefined) return undefined

  const object = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  return object ? (parsed as Record<string, unknown>) : null
}

export function listIn(raw: string | null | undefined): unknown[] | null {
  const parsed = parsedOr(raw)
  return Array.isArray(parsed) ? parsed : null
}

export function objectIn(raw: string | null | undefined): Record<string, unknown> | null {
  const parsed = parsedOr(raw)
  const object = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  return object ? (parsed as Record<string, unknown>) : null
}

function parsedOr(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function textAtMost(response: Response, limit: number): Promise<string | null> {
  const bytes = await bytesAtMost(response, limit)
  return bytes === null ? null : new TextDecoder().decode(bytes)
}

export async function bytesAtMost(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) return null
  if (!response.body) return new Uint8Array()

  const reader: { read(): Promise<{ done: boolean; value?: unknown }>; cancel(): Promise<void> } =
    response.body.getReader()

  const pieces: Uint8Array[] = []
  let held = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) continue

      held += value.length
      if (held > limit) return null
      pieces.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const whole = new Uint8Array(held)
  let at = 0
  for (const piece of pieces) {
    whole.set(piece, at)
    at += piece.length
  }

  return whole
}

export interface Body {
  problem: string | null
  text(name: string, limit: number): string | undefined
  nullableText(name: string, limit: number): string | null | undefined
  flag(name: string): boolean | undefined
  count(name: string): number | undefined
  texts(name: string, most: number, limit: number): string[] | undefined
}

export async function readBody(source: HasJson): Promise<Body> {
  const sent = await objectBody(source)
  const fields = sent ?? {}

  let problem: string | null = sent ? null : 'send a JSON object'

  function wrong(sentence: string): void {
    problem ??= sentence
  }

  function present(name: string): boolean {
    return Object.hasOwn(fields, name) && fields[name] !== undefined
  }

  function textOf(name: string, limit: number): string | undefined {
    const value = fields[name]

    if (typeof value !== 'string') {
      wrong(`${name} must be text`)
      return undefined
    }
    if (value.length > limit) {
      wrong(`${name} is longer than ${limit} characters`)
      return undefined
    }
    return value
  }

  return {
    get problem() {
      return problem
    },

    text(name, limit) {
      return present(name) ? textOf(name, limit) : undefined
    },

    nullableText(name, limit) {
      if (!present(name)) return undefined
      return fields[name] === null ? null : textOf(name, limit)
    },

    flag(name) {
      if (!present(name)) return undefined

      const value = fields[name]
      if (typeof value !== 'boolean') {
        wrong(`${name} must be true or false`)
        return undefined
      }
      return value
    },

    count(name) {
      if (!present(name)) return undefined

      const value = fields[name]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        wrong(`${name} must be a number`)
        return undefined
      }
      return value
    },

    texts(name, most, limit) {
      if (!present(name)) return undefined

      const value = fields[name]
      if (!Array.isArray(value)) {
        wrong(`${name} must be a list`)
        return undefined
      }
      if (value.length > most) {
        wrong(`${name} holds at most ${most} entries`)
        return undefined
      }
      if (!value.every((one) => typeof one === 'string' && one.length <= limit)) {
        wrong(`${name} must be a list of text`)
        return undefined
      }
      return value as string[]
    },
  }
}
