import { describe, expect, test } from 'vitest'
import { LanguageDescription } from '@codemirror/language'
import { languages as stock } from '@codemirror/language-data'
import { fenceLanguages, SPELLINGS } from './languages'
import { DIAGRAM_LANGUAGES } from './live-preview/render'
import { isRunnableLanguage } from './run/run'

/** What a fence saying this word opens, the way `markdown()` asks it. */
const languageFor = (word: string) =>
  LanguageDescription.matchLanguageName(fenceLanguages, word, true)?.name ?? null

describe('the word a fence is opened with', () => {
  /** The spellings people type, and what each has to come out as. Every one of
   *  these is a fence somebody has written; the point of the list is that the
   *  short spelling and the long one land in the same place. */
  const expected: Record<string, string> = {
    // Two or three ways to say the same everyday language.
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
    ex: 'Elixir',
    exs: 'Elixir',
    elixir: 'Elixir',
    matlab: 'Octave',
    racket: 'Scheme',
    elisp: 'Common Lisp',
    delphi: 'Pascal',
    raku: 'Perl',

    // Shells, and the transcripts people paste out of one.
    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    fish: 'Shell',
    console: 'Shell',
    'shell-session': 'Shell',
    ps1: 'PowerShell',
    powershell: 'PowerShell',
    pwsh: 'PowerShell',

    // Markup and the web.
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

    // Data, configuration and the files a repository is full of.
    yml: 'YAML',
    yaml: 'YAML',
    helm: 'YAML',
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
    dockerfile: 'Dockerfile',
    docker: 'Dockerfile',
    proto: 'ProtoBuf',
    protobuf: 'ProtoBuf',
    diff: 'diff',
    patch: 'diff',
    wat: 'WebAssembly',
    asm: 'Gas',

    // SQL, which is a family rather than a language.
    sql: 'SQL',
    psql: 'PostgreSQL',
    postgres: 'PostgreSQL',
    tsql: 'MS SQL',
    sqlite3: 'SQLite',

    // Languages added here for want of a maintained grammar anywhere else.
    zig: 'Zig',
    bicep: 'Bicep',
    awk: 'AWK',
    glsl: 'GLSL',
    solidity: 'Solidity',

    // A fence that says it is not code.
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
  })
})

describe('the list itself', () => {
  test('every language is named once', () => {
    const names = fenceLanguages.map((language) => language.name)
    expect(names).toHaveLength(new Set(names).size)
  })

  test('no two languages answer to the same word', () => {
    const claimed = new Map<string, string>()

    for (const language of fenceLanguages) {
      for (const word of language.alias) {
        expect(claimed.get(word) ?? language.name, `\`\`\`${word}`).toBe(language.name)
        claimed.set(word, language.name)
      }
    }
  })

  /** A spelling filed against a name the stock list does not use is a line
   *  that quietly does nothing, which is the one way this file can rot. */
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
      const language = fenceLanguages.find((other) => other.name === original.name)
      expect(language?.alias, original.name).toEqual(expect.arrayContaining([...original.alias]))
    }
  })
})

describe('what a fence is besides code', () => {
  /** Mermaid, flow and sequence fences are drawn as pictures rather than
   *  coloured as code, and the Run button reads the same word again. Both look
   *  the fence's language up their own way, so neither is protected by the
   *  list above. */
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
})

describe('loading a language', () => {
  /** One of each mechanism: a stock description that was given more
   *  spellings, a CodeMirror 5 mode, a language described by its vocabulary,
   *  a package written for CodeMirror 6, and one of this repo's own. */
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
    'plaintext',
    'mermaid',
  ]

  for (const word of sample) {
    test(`\`\`\`${word} loads and parses`, async () => {
      const description = LanguageDescription.matchLanguageName(fenceLanguages, word, true)!
      const support = await description.load()

      expect(support.language.parser.parse('x')).toBeTruthy()
    })
  }
})
