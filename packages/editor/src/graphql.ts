import type { StreamParser, StringStream } from '@codemirror/language'

/** GraphQL, which has no CodeMirror 5 mode and whose CodeMirror 6 package
 *  brings the whole GraphQL reference implementation with it - a megabyte to
 *  colour a fence with.
 *
 *  It does not need one. The language is small and its shape is carried by two
 *  positions: the word after `type`, `on` or `fragment` names a type, and so
 *  does whatever follows a colon. Everything else is a field, a keyword or
 *  punctuation. */

/** The words that open a definition or an operation. */
const KEYWORDS =
  /^(query|mutation|subscription|fragment|on|type|interface|union|enum|input|scalar|schema|extend|implements|directive|repeatable)\b/

/** The keywords a type name follows. */
const NAMES_A_TYPE = /^(fragment|on|type|interface|union|enum|input|scalar|extend|implements)$/

const ATOMS = /^(true|false|null)\b/

interface GraphQLState {
  /** Set when the last thing read was a colon or a word that a type follows,
   *  which is what tells a type name from a field name. */
  type: boolean
  /** Set inside a `"""` block string, which runs over lines. */
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

    // `$id: ID!` - the variables an operation takes.
    if (stream.match(/^\$[_A-Za-z][_A-Za-z0-9]*/)) return 'variableName.special'

    // `@include(if: $yes)` - a directive reads as a call on the field.
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

    // A colon introduces a type, wherever it appears; `[Post!]!` keeps that
    // promise open until the name arrives.
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
