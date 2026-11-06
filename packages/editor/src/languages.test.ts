import { describe, expect, test } from 'vitest'
import { LanguageDescription, StringStream, type StreamParser } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { languages as stock } from '@codemirror/language-data'
import { htmlToMarkdown } from '@orden/markdown/from-html'
import { fenceLanguages } from './languages'
import { SPELLINGS } from './language-spellings'
import { DIAGRAM_LANGUAGES } from './live-preview/render'
import { isRunnableLanguage } from './run/door'
import { graphqlParser } from './graphql'
import { makefileParser } from './makefile'
import { mermaidParser } from './mermaid'
import { prismaParser } from './prisma'

const languages = await fenceLanguages()

const languageFor = (word: string) =>
  LanguageDescription.matchLanguageName(languages, word, true)?.name ?? null

describe('the word a fence is opened with', () => {
  const expected: Record<string, string> = {
    js: 'JavaScript',
    javascript: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    node: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    mts: 'TypeScript',
    tsx: 'TSX',
    jsx: 'JSX',
    py: 'Python',
    python: 'Python',
    python3: 'Python',
    rb: 'Ruby',
    ruby: 'Ruby',
    rs: 'Rust',
    rust: 'Rust',
    go: 'Go',
    golang: 'Go',
    kt: 'Kotlin',
    kts: 'Kotlin',
    cs: 'C#',
    csharp: 'C#',
    'c#': 'C#',
    'c++': 'C++',
    cpp: 'C++',
    hpp: 'C++',
    c: 'C',
    h: 'C',
    objc: 'Objective-C',
    'objective-c': 'Objective-C',
    swift: 'Swift',
    php: 'PHP',
    jl: 'Julia',
    hs: 'Haskell',
    clj: 'Clojure',
    cljs: 'ClojureScript',
    ml: 'OCaml',
    fs: 'F#',
    erl: 'Erlang',
    cuda: 'C++',
    ex: 'Elixir',
    exs: 'Elixir',
    elixir: 'Elixir',
    matlab: 'Octave',
    racket: 'Scheme',
    elisp: 'Common Lisp',
    delphi: 'Pascal',
    raku: 'Perl',

    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    fish: 'Shell',
    console: 'Shell',
    'shell-session': 'Shell',
    ps1: 'PowerShell',
    powershell: 'PowerShell',
    pwsh: 'PowerShell',

    html: 'HTML',
    htm: 'HTML',
    hbs: 'HTML',
    svg: 'XML',
    vue: 'Vue',
    svelte: 'Svelte',
    astro: 'HTML',
    md: 'Markdown',
    markdown: 'Markdown',
    scss: 'SCSS',

    yml: 'YAML',
    yaml: 'YAML',
    helm: 'YAML',
    compose: 'YAML',
    k8s: 'YAML',
    json: 'JSON',
    json5: 'JSON',
    jsonc: 'JSON',
    toml: 'TOML',
    ini: 'Properties files',
    env: 'Properties files',
    dotenv: 'Properties files',
    systemd: 'Properties files',
    tf: 'Terraform',
    terraform: 'Terraform',
    hcl: 'Terraform',
    nix: 'Nix',
    make: 'Makefile',
    makefile: 'Makefile',
    graphql: 'GraphQL',
    gql: 'GraphQL',
    prisma: 'Prisma',
    dockerfile: 'Dockerfile',
    docker: 'Dockerfile',
    proto: 'ProtoBuf',
    protobuf: 'ProtoBuf',
    diff: 'diff',
    patch: 'diff',
    wat: 'WebAssembly',
    asm: 'Gas',

    sql: 'SQL',
    psql: 'PostgreSQL',
    postgres: 'PostgreSQL',
    tsql: 'MS SQL',
    sqlite3: 'SQLite',

    zig: 'Zig',
    bicep: 'Bicep',
    awk: 'AWK',
    glsl: 'GLSL',
    solidity: 'Solidity',

    plaintext: 'Plain Text',
    text: 'Plain Text',
    txt: 'Plain Text',
    none: 'Plain Text',
    nohighlight: 'Plain Text',
    rst: 'Plain Text',
  }

  for (const [word, language] of Object.entries(expected)) {
    test(`\`\`\`${word} is ${language}`, () => {
      expect(languageFor(word)).toBe(language)
    })
  }

  test('the spelling is read whatever case it is written in', () => {
    expect(languageFor('Python')).toBe('Python')
    expect(languageFor('JSON')).toBe('JSON')
    expect(languageFor('Dockerfile')).toBe('Dockerfile')
  })

  test('a word nobody has a language for stays plain code', () => {
    expect(languageFor('notalanguage')).toBeNull()
    expect(languageFor('')).toBeNull()
    expect(languageFor('rescript')).toBeNull()
    expect(languageFor('applescript')).toBeNull()
    expect(languageFor('gleam')).toBeNull()
  })
})

describe('the list itself', () => {
  test('every language is named once', () => {
    const names = languages.map((language) => language.name)
    expect(names).toHaveLength(new Set(names).size)
  })

  test('no two languages answer to the same word', () => {
    const claimed = new Map<string, string>()

    for (const language of languages) {
      for (const word of language.alias) {
        expect(claimed.get(word) ?? language.name, `\`\`\`${word}`).toBe(language.name)
        claimed.set(word, language.name)
      }
    }
  })

  test('every spelling is filed against a language that exists', () => {
    for (const [name, spellings] of Object.entries(SPELLINGS)) {
      expect(
        stock.some((original) => original.name === name),
        name,
      ).toBe(true)

      for (const word of spellings) expect(languageFor(word), `\`\`\`${word}`).toBe(name)
    }
  })

  test('the stock list is still here in full', () => {
    for (const original of stock) {
      const language = languages.find((other) => other.name === original.name)
      expect(language?.alias, original.name).toEqual(expect.arrayContaining([...original.alias]))
    }
  })
})

describe('what a fence is besides code', () => {
  test('the fences drawn as pictures still are', () => {
    expect([...DIAGRAM_LANGUAGES]).toEqual(['mermaid', 'flow', 'sequence'])
    expect(languageFor('mermaid')).toBe('mermaid')
  })

  test('the fences the run button appears on still are', () => {
    for (const word of ['js', 'javascript', 'mjs', 'cjs']) {
      expect(isRunnableLanguage(word), word).toBe(true)
      expect(languageFor(word)).toBe('JavaScript')
    }

    for (const word of ['ts', 'python', 'node']) expect(isRunnableLanguage(word)).toBe(false)
  })

  test('the two a clipped page may not choose are the two that need no press', () => {
    const fenced = (language: string) =>
      htmlToMarkdown(`<pre data-language="${language}"><code>x</code></pre>`)

    const block = (language: string) => ['```' + language, 'x', '```'].join('\n')

    expect(fenced('query')).toBe(block(''))
    expect(fenced('ai')).toBe(block(''))

    for (const word of [...DIAGRAM_LANGUAGES, 'chart', 'js', 'javascript', 'mjs', 'cjs']) {
      expect(fenced(word), word).toBe(block(word))
    }
  })
})

describe('loading a language', () => {
  const sample = [
    'py',
    'rs',
    'glsl',
    'awk',
    'zig',
    'elixir',
    'nix',
    'svelte',
    'solidity',
    'terraform',
    'makefile',
    'graphql',
    'prisma',
    'plaintext',
    'mermaid',
  ]

  for (const word of sample) {
    test(`\`\`\`${word} loads and parses`, async () => {
      const description = LanguageDescription.matchLanguageName(languages, word, true)!
      const support = await description.load()

      expect(support.language.parser.parse('x')).toBeTruthy()
    })
  }
})

describe('the token types this repo names itself', () => {
  const known = (type: string) =>
    type
      .split('.')
      .every((part, index) =>
        index === 0
          ? typeof (tags as Record<string, unknown>)[part] === 'object'
          : typeof (tags as Record<string, unknown>)[part] === 'function',
      )

  const samples: [string, StreamParser<never>, string][] = [
    ['mermaid', mermaidParser as StreamParser<never>, 'graph TD\n  A["a"] --> B\n  %% a note'],
    [
      'makefile',
      makefileParser as StreamParser<never>,
      '# build\nCC := gcc\nall: $(OBJ)\n\t$(CC) -o "app" main.c\nifeq ($(OS),nt)\nendif',
    ],
    [
      'graphql',
      graphqlParser as StreamParser<never>,
      '# a schema\n"""doc"""\ntype User {\n  id: ID!\n  posts(n: 10): [Post!]! @cache\n}\nquery H($id: ID) { user }',
    ],
    [
      'prisma',
      prismaParser as StreamParser<never>,
      '// a schema\ndatasource db {\n  url = env("DB")\n}\nmodel User {\n  id Int @id @default(3)\n  posts Post[]\n}',
    ],
  ]

  for (const [name, parser, sample] of samples) {
    test(`${name} names only tags CodeMirror knows`, () => {
      const state = parser.startState!(2)

      for (const line of sample.split('\n')) {
        const stream = new StringStream(line, 2, 2)

        while (!stream.eol()) {
          const type = parser.token(stream, state)
          expect(type === null || known(type), `${name}: ${type}`).toBe(true)
        }
      }
    })
  }
})
