import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language'

function streamMode(spec: {
  name: string
  alias: string[]
  extensions?: string[]
  parser: () => Promise<StreamParser<unknown>>
}): LanguageDescription {
  return LanguageDescription.of({
    name: spec.name,
    alias: spec.alias,
    extensions: spec.extensions ?? [],
    load: async () => new LanguageSupport(StreamLanguage.define(await spec.parser())),
  })
}

const words = (list: string): Record<string, boolean> =>
  Object.fromEntries(
    list
      .split(' ')
      .filter(Boolean)
      .map((word) => [word, true]),
  )

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

const hashComment = {
  '#': (stream: { skipToEnd(): void }) => {
    stream.skipToEnd()
    return 'comment'
  },
}

const plainTextParser: StreamParser<unknown> = {
  name: 'plaintext',
  token: (stream) => {
    stream.skipToEnd()
    return null
  },
}

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
  load: () => Promise.resolve(new LanguageSupport(StreamLanguage.define(plainTextParser))),
})

export const ADDED: LanguageDescription[] = [
  streamMode({
    name: 'GLSL',
    alias: ['glsl', 'hlsl', 'shader', 'shaderlab', 'opengl'],
    extensions: ['glsl', 'frag', 'vert', 'geom', 'comp'],
    parser: async () => (await import('@codemirror/legacy-modes/mode/clike')).shader,
  }),
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
  LanguageDescription.of({
    name: 'Terraform',
    alias: ['terraform', 'tf', 'tfvars', 'hcl', 'nomad', 'packer'],
    extensions: ['tf', 'tfvars', 'hcl'],
    load: async () => (await import('codemirror-lang-hcl')).hcl(),
  }),

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
