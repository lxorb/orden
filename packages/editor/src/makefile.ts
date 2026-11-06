import type { StreamParser, StringStream } from '@codemirror/language'

const DIRECTIVES =
  /^(ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|undefine|include|-include|sinclude|export|unexport|override|vpath|private)\b/

const ASSIGNED = /^[A-Za-z_.][\w.-]*(?=[ \t]*(::=|:=|\?=|\+=|!=|=))/

const TARGET = /^[^\s:#=]+(?=[ \t]*:)/

const OPERATORS = /^(::=|:=|\?=|\+=|!=|=|::|:|\||;|&)/

interface MakefileState {
  recipe: boolean
}

function variable(stream: StringStream): string {
  stream.next()
  const open = stream.peek()

  if (open !== '(' && open !== '{') {
    stream.next()
    return 'propertyName'
  }

  const close = open === '(' ? ')' : '}'
  let depth = 0

  for (let character = stream.next(); character; character = stream.next()) {
    if (character === open) depth++
    else if (character === close && --depth === 0) break
  }

  return 'propertyName'
}

export const makefileParser: StreamParser<MakefileState> = {
  name: 'makefile',

  startState: () => ({ recipe: false }),

  token(stream: StringStream, state) {
    const lineStart = stream.sol()
    if (lineStart) state.recipe = stream.peek() === '\t'

    if (stream.eatSpace()) return null
    if (stream.match(/^#.*/)) return 'comment'
    if (stream.peek() === '$') return variable(stream)

    if (state.recipe) {
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
      if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string'
      if (stream.match(/^[^$"'\s]+/)) return null

      stream.next()
      return null
    }

    if (stream.match(DIRECTIVES)) return 'keyword'
    if (lineStart && stream.match(ASSIGNED)) return 'propertyName'
    if (lineStart && stream.match(TARGET)) return 'labelName'
    if (stream.match(OPERATORS)) return 'operator'
    if (stream.match(/^[^\s$#:=|;&]+/)) return null

    stream.next()
    return null
  },

  languageData: { commentTokens: { line: '#' } },
}
