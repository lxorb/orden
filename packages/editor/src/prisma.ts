import type { StreamParser, StringStream } from '@codemirror/language'

/** Prisma's schema language, which anyone working on a TypeScript backend has
 *  a fence of somewhere.
 *
 *  A schema is a stack of blocks of `name Type @attribute` lines, so the
 *  parser only has to know where it is on the line: the first word names a
 *  field, the second names its type, and the rest are attributes. */

/** The words that open a block, each followed by the name of what it opens. */
const BLOCKS = /^(datasource|generator|model|enum|type|view)\b/

/** `@id`, `@default(now())`, `@@unique([a, b])`. */
const ATTRIBUTE = /^@@?[A-Za-z][\w.]*/

interface PrismaState {
  /** Set once the first word of the line has been read, so the next one is
   *  read as that field's type. */
  type: boolean
  /** Cleared by the first word of a line and by the brace that opens a block. */
  start: boolean
}

export const prismaParser: StreamParser<PrismaState> = {
  name: 'prisma',

  startState: () => ({ type: false, start: true }),

  token(stream: StringStream, state) {
    if (stream.sol()) {
      state.start = true
      state.type = false
    }

    if (stream.eatSpace()) return null

    if (stream.match(/^\/\/.*/)) return 'comment'
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number'
    if (stream.match(/^(true|false|null)\b/)) return 'atom'
    if (stream.match(ATTRIBUTE)) {
      state.start = false
      return 'variableName.function'
    }

    const name = stream.match(/^[A-Za-z_][\w.]*/)
    if (Array.isArray(name)) {
      const wasType = state.type
      const wasStart = state.start

      state.type = wasStart && !wasType
      state.start = false

      if (wasStart && BLOCKS.test(name[0])) {
        state.type = true
        return 'definitionKeyword'
      }

      if (wasType) return 'typeName'
      return wasStart ? 'propertyName' : null
    }

    if (stream.match(/^[[\]{}(),]/)) {
      // The brace that opens a block ends the line it was on, and the one that
      // closes it leaves nothing behind either.
      state.type = false
      return 'punctuation'
    }
    if (stream.match(/^[=?:]/)) {
      // A value follows, not a type: `url = env("DATABASE_URL")`.
      state.type = false
      return 'operator'
    }

    stream.next()
    return null
  },

  languageData: { commentTokens: { line: '//' } },
}
