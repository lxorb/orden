import type { StreamParser, StringStream } from '@codemirror/language'

const BLOCKS = /^(datasource|generator|model|enum|type|view)\b/

const ATTRIBUTE = /^@@?[A-Za-z][\w.]*/

interface PrismaState {
  type: boolean
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
      state.type = false
      return 'punctuation'
    }
    if (stream.match(/^[=?:]/)) {
      state.type = false
      return 'operator'
    }

    stream.next()
    return null
  },

  languageData: { commentTokens: { line: '//' } },
}
