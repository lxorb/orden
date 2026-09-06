import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language'
import { languages as stock } from '@codemirror/language-data'
import { mermaidDescription } from './mermaid'

/** Every language a fence may name, in one list.
 *
 *  `@codemirror/language-data` brings 143 of them and each one imports itself
 *  the first time a fence asks for it - nothing here is in the startup bundle.
 *  What that list is short on is *spellings*: it knows the language by its
 *  name, and a fence is opened by whatever word came to hand.
 *
 *  So this file is mostly a vocabulary, and only then a language list. Adding
 *  a spelling to a language that is already here is one line in `SPELLINGS`;
 *  adding a language nobody has ported is one entry in `ADDED`. */

/** Spellings the stock list has, but files under file extensions rather than
 *  names.
 *
 *  A fence's info word is matched against a language's name and its aliases,
 *  and never against its extensions - so ```py, ```rs, ```kt and ```md, four
 *  of the commonest fences anyone writes, all opened plain grey text while the
 *  spelled-out name worked. Each line hands the words people actually type to
 *  a description that already exists, and loads nothing new for them. */
export const SPELLINGS: Record<string, string[]> = {
  // The everyday ones, by every name they go by.
  Python: ['py', 'py3', 'python3', 'starlark', 'bzl', 'bazel', 'vyper'],
  JavaScript: ['mjs', 'cjs', 'es6', 'nodejs'],
  TypeScript: ['mts', 'cts'],
  Rust: ['rs'],
  Go: ['golang'],
  Kotlin: ['kt', 'kts'],
  Scala: ['sc'],
  C: ['h', 'ino'],
  'C++': ['cc', 'cxx', 'hpp', 'hh', 'hxx', 'h++', 'cuda', 'metal'],
  'Objective-C': ['objectivec', 'obj-c'],
  'Objective-C++': ['objectivecpp', 'obj-c++'],
  Perl: ['pl', 'pm', 'raku', 'perl6', 'p6'],
  Haskell: ['hs', 'purescript', 'purs', 'idris'],
  // No `escript`: it is a real Erlang spelling, but the near-match rule then
  // reads `rescript` and `applescript` as Erlang too, which is worse than
  // leaving all three alone.
  Erlang: ['erl'],
  OCaml: ['ml', 'mli'],
  'F#': ['fs', 'fsx', 'fsi'],
  'Common Lisp': ['cl', 'elisp', 'emacs-lisp', 'emacslisp', 'commonlisp'],
  Scheme: ['scm', 'ss', 'racket', 'rkt', 'guile'],
  Clojure: ['clj', 'cljc', 'cljx'],
  ClojureScript: ['cljs'],
  Julia: ['jl'],
  Crystal: ['cr'],
  Cython: ['pyx', 'pxd'],
  Haxe: ['hx'],
  D: ['dlang'],
  Fortran: ['f90', 'f95', 'f03', 'f08', 'f77'],
  Cobol: ['cob', 'cbl'],
  Pascal: ['pas', 'delphi', 'objectpascal'],
  'VB.NET': ['vb', 'vbnet', 'vba', 'visualbasic'],
  Groovy: ['gradle', 'jenkinsfile'],
  Octave: ['matlab'],
  Mathematica: ['wolfram', 'wl'],
  PowerShell: ['ps1', 'pwsh', 'psm1', 'psd1', 'posh'],
  SystemVerilog: ['sv', 'svh'],
  VHDL: ['vhd'],
  Brainfuck: ['bf'],

  // A pasted terminal is a shell fence under another name, and the transcript
  // spellings - console, shell-session - are how most people write one.
  Shell: [
    'ksh',
    'fish',
    'console',
    'terminal',
    'shell-session',
    'shellsession',
    'bash-session',
  ],
  // GAS is AT&T syntax and NASM is Intel's, but the two agree on what a
  // comment, a label, a register and a number look like, which is all a fence
  // is being coloured for.
  Gas: ['asm', 'assembly', 'nasm', 'x86', 'x86asm', 'armasm'],

  // Markup, and the template dialects that are markup with holes in.
  HTML: ['htm', 'handlebars', 'hbs', 'mustache', 'erb', 'ejs', 'astro'],
  XML: ['svg', 'xsl', 'xslt', 'plist', 'xaml'],
  Markdown: ['md', 'mkd', 'mdown', 'mdx'],
  Jinja: ['jinja2', 'j2', 'twig', 'nunjucks', 'njk'],
  'Angular Template': ['angular'],
  Stylus: ['styl'],
  LaTeX: ['bibtex', 'bib'],

  // Data and configuration, where the fence is usually named after the file.
  JSON: ['jsonc', 'jsonl', 'ndjson', 'geojson'],
  // A Helm chart is YAML with Go template holes; the stock fuzzy match read
  // `helm` as Elm and coloured it as a functional language.
  YAML: ['helm', 'compose', 'docker-compose', 'ansible', 'k8s', 'kubernetes'],
  // The INI mode is loose enough to cover everything shaped like key=value:
  // .env files, systemd units, .gitconfig, .npmrc.
  'Properties files': [
    'env',
    'dotenv',
    'conf',
    'config',
    'cfg',
    'editorconfig',
    'systemd',
    'gitconfig',
    'npmrc',
  ],
  Dockerfile: ['docker', 'containerfile'],
  ProtoBuf: ['proto', 'proto3'],
  diff: ['patch', 'udiff'],
  WebAssembly: ['wat', 'wast', 'wasm'],
  Turtle: ['ttl'],
  SPARQL: ['rq'],
  Gherkin: ['feature', 'cucumber'],

  // The SQL dialects, which stock data registers under their long names only.
  PostgreSQL: ['psql', 'postgres', 'pgsql'],
  'MS SQL': ['mssql', 'tsql', 'sqlserver'],
  'MariaDB SQL': ['mariadb'],
  SQLite: ['sqlite3'],
  PLSQL: ['pls', 'oracle'],
}

/** The stock list, each description carrying the spellings above. */
const spelled = stock.map((description) => {
  const extra = SPELLINGS[description.name]
  if (!extra) return description

  return LanguageDescription.of({
    name: description.name,
    alias: [...description.alias, ...extra],
    extensions: description.extensions,
    // Deferring to the stock description rather than repeating its import:
    // whichever of the two is asked first, the language loads once.
    load: () => description.load(),
  })
})

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
    extensions: spec.extensions,
    load: async () => new LanguageSupport(StreamLanguage.define(await spec.parser())),
  })
}

/** Words to the shape the C-like tokenizer wants them in. */
const words = (list: string): Record<string, boolean> =>
  Object.fromEntries(list.split(' ').filter(Boolean).map((word) => [word, true]))

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
    extensions: spec.extensions,
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
const plainTextDescription = LanguageDescription.of({
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
  load: async () => new LanguageSupport(StreamLanguage.define(plainTextParser)),
})

/** Languages the stock list leaves out. */
const ADDED: LanguageDescription[] = [
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

/** What a fence's info word is matched against - by the editor while the note
 *  is open, and by the HTML export afterwards, so a document leaves looking
 *  the way it did on screen. */
export const fenceLanguages: LanguageDescription[] = [
  plainTextDescription,
  ...spelled,
  ...ADDED,
  // Mermaid's parser lives beside the code that draws the diagram.
  mermaidDescription,
]
