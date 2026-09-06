import type { StreamParser, StringStream } from '@codemirror/language'

/** Make has never been ported to CodeMirror, in five and a bit versions of it,
 *  and a makefile is one of the things people most often paste into a note.
 *
 *  It is two languages in one file, which is the whole difficulty: the lines
 *  that begin with a tab are shell, and everything else is make. So the parser
 *  keeps one bit of state - whether this line is a recipe - and stops trying
 *  to read make's grammar in the lines that are not written in it. */

/** The words that direct make rather than name something. */
const DIRECTIVES =
  /^(ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|undefine|include|-include|sinclude|export|unexport|override|vpath|private)\b/

/** A name being given a value: `CC =`, `CFLAGS +=`, `SHELL :=`. */
const ASSIGNED = /^[A-Za-z_.][\w.-]*(?=[ \t]*(::=|:=|\?=|\+=|!=|=))/

/** A target, which is anything followed by the colon that names its
 *  prerequisites - `build:`, `%.o:`, `.PHONY:`. */
const TARGET = /^[^\s:#=]+(?=[ \t]*:)/

const OPERATORS = /^(::=|:=|\?=|\+=|!=|=|::|:|\||;|&)/

interface MakefileState {
  /** Set while the line began with a tab, which hands it to the shell. */
  recipe: boolean
}

/** `$(CC)`, `${CC}` and the one-character automatic variables `$@` and `$<`.
 *  Counting the brackets keeps `$(dir $(FILE))` in one piece. */
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

    // Inside a recipe the rest is a shell command, and make's punctuation
    // means nothing there. Quotes are worth marking; the rest is left alone.
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
