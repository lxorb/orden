import { LanguageDescription } from '@codemirror/language'
import { languages as stock } from '@codemirror/language-data'

/** The words people actually open a fence with, handed to the languages
 *  `@codemirror/language-data` already knows.
 *
 *  A vocabulary rather than a language list: nothing here loads a parser, and
 *  every entry defers to a stock description that was going to load one anyway.
 *  See languages.ts for how it fits together, and language-modes.ts for the
 *  languages the stock list has no entry for at all. */

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
  Shell: ['ksh', 'fish', 'console', 'terminal', 'shell-session', 'shellsession', 'bash-session'],
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
export const spelled = stock.map((description) => {
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
