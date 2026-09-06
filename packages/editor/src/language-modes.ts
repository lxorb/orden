import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language'

/** The languages `@codemirror/language-data` has no entry for at all, each one
 *  tokenized by a stream mode.
 *
 *  A stream mode reads a line at a time and answers what kind of token it is
 *  looking at, which is enough to tell a comment from a string from a keyword
 *  and no more. That is the whole bargain: a language with no maintained grammar
 *  is still readable in a fence, and a tokenizer - unlike a parser - cannot
 *  mangle what it does not understand. `cLike` below is most of it, because most
 *  of these languages differ from each other only in their vocabulary.
 *
 *  Every import sits inside a `load`, so nothing here is fetched until a fence
 *  asks for it. */

/** A stream tokenizer as a language a fence can name - one of the CodeMirror 5
 *  modes in `@codemirror/legacy-modes`, or one of this repo's own. The import
 *  sits inside `load`, so the tokenizer is fetched the first time someone opens
 *  such a fence and never before - the same bargain the stock list makes for
 *  all 143 of its own. */
function streamMode(spec: {
  name: string
  alias: string[]
  extensions?: string[]
  parser: () => Promise<StreamParser<unknown>>
}): LanguageDescription {
  return LanguageDescription.of({
    name: spec.name,
    alias: spec.alias,
    // An empty list and no list are the same to a description; the compiler
    // minds the difference, so the choice is made here rather than passed on.
    extensions: spec.extensions ?? [],
    load: async () => new LanguageSupport(StreamLanguage.define(await spec.parser())),
  })
}

/** Words to the shape the C-like tokenizer wants them in. */
const words = (list: string): Record<string, boolean> =>
  Object.fromEntries(
    list
      .split(' ')
      .filter(Boolean)
      .map((word) => [word, true]),
  )

/** A language described only by its vocabulary, tokenized by the mode C, Java,
 *  Kotlin and a dozen others already share.
 *
 *  It is an approximation and says so: it knows a line comment from a string
 *  from a number, and it knows which words are keywords, which is what makes a
 *  fence readable. It does not know the language's grammar, so it cannot mark
 *  a function's name or catch a mistake - and, being a stream tokenizer, it
 *  cannot mangle anything either. For a language with no maintained grammar
 *  that trade is the right way round. */
function cLike(spec: {
  name: string
  alias: string[]
  extensions?: string[]
  keywords: string
  types?: string
  atoms?: string
  builtin?: string
  hooks?: Record<string, (stream: { skipToEnd(): void }) => string>
}): LanguageDescription {
  return streamMode({
    name: spec.name,
    alias: spec.alias,
    extensions: spec.extensions ?? [],
    parser: async () => {
      const { clike } = await import('@codemirror/legacy-modes/mode/clike')
      return clike({
        name: spec.name.toLowerCase(),
        keywords: words(spec.keywords),
        types: words(spec.types ?? ''),
        atoms: words(spec.atoms ?? 'true false null'),
        builtin: words(spec.builtin ?? ''),
        hooks: spec.hooks ?? {},
      })
    },
  })
}

/** A line comment that runs to the end of the line, for the C-like mode's
 *  hook table - the languages below that comment with `#` rather than `//`. */
const hashComment = {
  '#': (stream: { skipToEnd(): void }) => {
    stream.skipToEnd()
    return 'comment'
  },
}

/** Nothing in the fence is a token. */
const plainTextParser: StreamParser<unknown> = {
  name: 'plaintext',
  token: (stream) => {
    stream.skipToEnd()
    return null
  },
}

/** A fence that says it holds no language at all.
 *
 *  It has to be a real language rather than an absent one, because the lookup
 *  falls back to matching a fence's word *inside* a language's aliases when
 *  nothing matches outright: ```plaintext and ```text both contain `tex`, and
 *  both used to come out coloured as LaTeX. `rst` and `asciidoc` ride along
 *  for the same reason - neither has a grammar here, and both would otherwise
 *  be read as TeX and mangled.
 *
 *  It is first in the list so that the same near-match rule sends anything
 *  else ending in -text here rather than to LaTeX. */
export const plainTextDescription = LanguageDescription.of({
  name: 'Plain Text',
  alias: [
    'plaintext',
    'plain',
    'text',
    'txt',
    'none',
    'nohighlight',
    'no-highlight',
    'raw',
    'output',
    'rst',
    'restructuredtext',
    'asciidoc',
    'adoc',
  ],
  extensions: ['txt', 'text', 'rst', 'adoc', 'asciidoc'],
  // Nothing to fetch: the tokenizer is right here, so the promise is already
  // kept. `load` is asked for a promise, not for an async function.
  load: () => Promise.resolve(new LanguageSupport(StreamLanguage.define(plainTextParser))),
})

/** Languages the stock list leaves out. */
export const ADDED: LanguageDescription[] = [
  // Shaders: one mode covers GLSL and HLSL, which differ in their builtins
  // rather than in their shape.
  streamMode({
    name: 'GLSL',
    alias: ['glsl', 'hlsl', 'shader', 'shaderlab', 'opengl'],
    extensions: ['glsl', 'frag', 'vert', 'geom', 'comp'],
    parser: async () => (await import('@codemirror/legacy-modes/mode/clike')).shader,
  }),
  // Two more that ride along in the same file the shaders come from, so
  // registering them costs a line and no bytes at all.
  streamMode({
    name: 'nesC',
    alias: ['nesc'],
    extensions: ['nc'],
    parser: async () => (await import('@codemirror/legacy-modes/mode/clike')).nesC,
  }),
  streamMode({
    name: 'Ceylon',
    alias: ['ceylon'],
    extensions: ['ceylon'],
    parser: async () => (await import('@codemirror/legacy-modes/mode/clike')).ceylon,
  }),
  streamMode({
    name: 'PEG.js',
    alias: ['pegjs', 'peg'],
    extensions: ['pegjs', 'peg'],
    parser: async () => (await import('@codemirror/legacy-modes/mode/pegjs')).pegjs,
  }),

  // Two SQL dialects the stock list skips, both of them what a data note is
  // usually written in.
  streamMode({
    name: 'Hive SQL',
    alias: ['hive', 'hiveql'],
    extensions: ['hql'],
    parser: async () => (await import('@codemirror/legacy-modes/mode/sql')).hive,
  }),
  streamMode({
    name: 'Spark SQL',
    alias: ['sparksql', 'spark-sql'],
    parser: async () => (await import('@codemirror/legacy-modes/mode/sql')).sparkSQL,
  }),

  // Languages with a grammar of their own, written for CodeMirror 6 and kept
  // up. A grammar knows the shape of the code and not only its vocabulary,
  // which is what marks a property apart from the value beside it - worth a
  // dependency for a language people write enough of. Each is a chunk nothing
  // fetches until a fence names it.
  LanguageDescription.of({
    name: 'Elixir',
    alias: ['elixir', 'ex', 'exs', 'iex'],
    extensions: ['ex', 'exs'],
    load: async () => (await import('codemirror-lang-elixir')).elixir(),
  }),
  LanguageDescription.of({
    name: 'Svelte',
    alias: ['svelte'],
    extensions: ['svelte'],
    load: async () => (await import('@replit/codemirror-lang-svelte')).svelte(),
  }),
  LanguageDescription.of({
    name: 'Nix',
    alias: ['nix', 'nixos'],
    extensions: ['nix'],
    load: async () => (await import('@replit/codemirror-lang-nix')).nix(),
  }),
  LanguageDescription.of({
    name: 'Solidity',
    alias: ['solidity', 'sol'],
    extensions: ['sol'],
    load: async () => (await import('@replit/codemirror-lang-solidity')).solidity,
  }),
  // HCL is the language; Terraform is what nearly every fence of it is. The
  // name people type wins, and `hcl`, `nomad` and `packer` answer to it too.
  LanguageDescription.of({
    name: 'Terraform',
    alias: ['terraform', 'tf', 'tfvars', 'hcl', 'nomad', 'packer'],
    extensions: ['tf', 'tfvars', 'hcl'],
    load: async () => (await import('codemirror-lang-hcl')).hcl(),
  }),

  // Three that nobody has ported at all, tokenized here. Each file says what
  // it knows and how it knows it.
  streamMode({
    name: 'Makefile',
    alias: ['makefile', 'make', 'mk', 'gnumakefile', 'bsdmake', 'just', 'justfile'],
    extensions: ['mk', 'mak'],
    parser: async () => (await import('./makefile')).makefileParser,
  }),
  streamMode({
    name: 'GraphQL',
    alias: ['graphql', 'gql'],
    extensions: ['graphql', 'gql', 'graphqls'],
    parser: async () => (await import('./graphql')).graphqlParser,
  }),
  streamMode({
    name: 'Prisma',
    alias: ['prisma'],
    extensions: ['prisma'],
    parser: async () => (await import('./prisma')).prismaParser,
  }),

  // Three more with nothing to import, and no need for a tokenizer of their
  // own: each is C-shaped enough that the shared one reads it correctly given
  // its words. See cLike above for what that does and does not promise.
  cLike({
    name: 'Zig',
    alias: ['zig'],
    extensions: ['zig'],
    keywords:
      'align allowzero and anyframe anytype asm async await break callconv catch comptime const ' +
      'continue defer else enum errdefer error export extern fn for if inline linksection noalias ' +
      'noinline nosuspend opaque or orelse packed pub resume return struct suspend switch test ' +
      'threadlocal try union unreachable usingnamespace var volatile while',
    types:
      'bool void noreturn type anyerror anyopaque comptime_int comptime_float isize usize ' +
      'i8 u8 i16 u16 i32 u32 i64 u64 i128 u128 f16 f32 f64 f80 f128 ' +
      'c_char c_short c_ushort c_int c_uint c_long c_ulong c_longlong c_ulonglong c_longdouble',
    atoms: 'true false null undefined',
  }),
  cLike({
    name: 'Bicep',
    alias: ['bicep'],
    extensions: ['bicep'],
    keywords:
      'targetScope param var resource module output existing import metadata provider type func ' +
      'assert with as if for in union',
    types: 'string int bool object array secureString secureObject',
  }),
  cLike({
    name: 'AWK',
    alias: ['awk', 'gawk', 'mawk'],
    extensions: ['awk'],
    keywords:
      'BEGIN END function func if else while for do break continue next nextfile exit return ' +
      'delete in getline print printf',
    builtin:
      'length substr index split sub gsub match sprintf sin cos atan2 exp log sqrt int rand srand ' +
      'tolower toupper system close fflush NR NF FS OFS ORS RS FILENAME FNR RSTART RLENGTH SUBSEP',
    hooks: hashComment,
  }),
]
