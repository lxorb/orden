/** Reading what a request carries, without ever trusting it.
 *
 *  A route asks for the fields it knows about, each with what it may be and
 *  how long it may get. Anything wrong - a body that is not a JSON object, a
 *  number where text was meant, a name past its limit - is remembered as one
 *  sentence, and the route answers 400 with it. That is the whole point: a
 *  malformed body used to reach `.trim()` or `.length` on something that had
 *  neither, and a client's mistake came back as a 500.
 *
 *  Nothing is coerced. `{"name": 12}` is a mistake in the client, not a name,
 *  and saying so is more use than storing "12".
 *
 *  The sentences are lowercase like every other message here, so the app can
 *  drop one into a line of its own text. */

/** Only the body is read, so this takes the smallest thing that has one. */
interface HasJson {
  req: { json: <T>() => Promise<T> }
}

export interface Body {
  /** The first thing wrong with what arrived, once something is. A route reads
   *  the fields it wants and then checks this once, which is where it answers. */
  problem: string | null
  /** Text, or undefined when the field was left out. */
  text(name: string, limit: number): string | undefined
  /** Text that may also arrive as null, which means "take this away". */
  nullableText(name: string, limit: number): string | null | undefined
  flag(name: string): boolean | undefined
  count(name: string): number | undefined
  /** A list of text: at most `most` entries, each at most `limit` long. */
  texts(name: string, most: number, limit: number): string[] | undefined
}

export async function readBody(source: HasJson): Promise<Body> {
  const parsed = await source.req.json<unknown>().catch(() => null)
  const object = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  const fields = object ? (parsed as Record<string, unknown>) : {}

  let problem: string | null = object ? null : 'send a JSON object'

  /** The first complaint is the one reported: a reader that kept going would
   *  end up describing a field the client has not got to yet. */
  function wrong(sentence: string): void {
    problem ??= sentence
  }

  /** Own keys only, so nothing inherited from Object can pass for a field. */
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
