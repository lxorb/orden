import type { StreamParser, StringStream } from '@codemirror/language'

const KEYWORDS =
  /^(query|mutation|subscription|fragment|on|type|interface|union|enum|input|scalar|schema|extend|implements|directive|repeatable)\b/

const NAMES_A_TYPE = /^(fragment|on|type|interface|union|enum|input|scalar|extend|implements)$/

const ATOMS = /^(true|false|null)\b/

interface GraphQLState {
  type: boolean
  block: boolean
}

export const graphqlParser: StreamParser<GraphQLState> = {
  name: 'graphql',

  startState: () => ({ type: false, block: false }),

  token(stream: StringStream, state) {
    if (state.block) {
      while (!stream.eol()) {
        if (stream.match('"""')) {
          state.block = false
          break
        }
        stream.next()
      }
      return 'string'
    }

    if (stream.eatSpace()) return null

    if (stream.match(/^#.*/)) return 'comment'

    if (stream.match('"""')) {
      state.block = true
      return 'string'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'

    if (stream.match(/^-?\d+(\.\d+)?([eE][-+]?\d+)?/)) return 'number'

    if (stream.match(/^\$[_A-Za-z][_A-Za-z0-9]*/)) return 'variableName.special'

    if (stream.match(/^@[_A-Za-z][_A-Za-z0-9]*/)) return 'variableName.function'

    if (stream.match('...')) {
      state.type = true
      return 'operator'
    }

    const name = stream.match(/^[_A-Za-z][_A-Za-z0-9]*/)
    if (Array.isArray(name)) {
      const word = name[0]
      const wasType = state.type
      state.type = false

      if (ATOMS.test(word)) return 'atom'
      if (KEYWORDS.test(word)) {
        state.type = NAMES_A_TYPE.test(word)
        return 'keyword'
      }

      return wasType ? 'typeName' : 'propertyName'
    }

    if (stream.match(/^[:[]/)) {
      state.type = true
      return 'punctuation'
    }
    if (stream.match(/^[}\])]/)) {
      state.type = false
      return 'punctuation'
    }
    if (stream.match(/^[{(,!|&=]/)) return 'punctuation'

    stream.next()
    return null
  },

  languageData: { commentTokens: { line: '#' } },
}
