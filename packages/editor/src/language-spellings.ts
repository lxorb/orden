import { LanguageDescription } from '@codemirror/language'
import { languages as stock } from '@codemirror/language-data'

export const SPELLINGS: Record<string, string[]> = {
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

  Shell: ['ksh', 'fish', 'console', 'terminal', 'shell-session', 'shellsession', 'bash-session'],
  Gas: ['asm', 'assembly', 'nasm', 'x86', 'x86asm', 'armasm'],

  HTML: ['htm', 'handlebars', 'hbs', 'mustache', 'erb', 'ejs', 'astro'],
  XML: ['svg', 'xsl', 'xslt', 'plist', 'xaml'],
  Markdown: ['md', 'mkd', 'mdown', 'mdx'],
  Jinja: ['jinja2', 'j2', 'twig', 'nunjucks', 'njk'],
  'Angular Template': ['angular'],
  Stylus: ['styl'],
  LaTeX: ['bibtex', 'bib'],

  JSON: ['jsonc', 'jsonl', 'ndjson', 'geojson'],
  YAML: ['helm', 'compose', 'docker-compose', 'ansible', 'k8s', 'kubernetes'],
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

  PostgreSQL: ['psql', 'postgres', 'pgsql'],
  'MS SQL': ['mssql', 'tsql', 'sqlserver'],
  'MariaDB SQL': ['mariadb'],
  SQLite: ['sqlite3'],
  PLSQL: ['pls', 'oracle'],
}

export const spelled = stock.map((description) => {
  const extra = SPELLINGS[description.name]
  if (!extra) return description

  return LanguageDescription.of({
    name: description.name,
    alias: [...description.alias, ...extra],
    extensions: description.extensions,
    load: () => description.load(),
  })
})
