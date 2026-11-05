/** A command line and what a terminal printed, as words. Pure; see terminal.ts. */

export type Os = 'windows' | 'unix'

export function osOf(platform: string): Os {
  return platform === 'windows' ? 'windows' : 'unix'
}

export function programOf(command: string, os: Os): string {
  const word = /^\s*(\S+)/.exec(command)?.[1] ?? ''
  if (!/^[\w.+-]+$/.test(word)) return ''

  return os === 'windows' ? word.toLowerCase().replace(/\.(exe|com|bat|cmd)$/, '') : word
}

const PACKAGES = { long: ['--script-shell', '--node-options'] }
const PLAIN = ['--version', '--help', '-v', '-h', '--silent', '-s']
const SCRIPTS = [
  'test',
  'build',
  'dev',
  'start',
  'stop',
  'restart',
  'lint',
  'check',
  'format',
  'typecheck',
  'preview',
  'serve',
]

const SCRIPT_BY_SHAPE = /^[\w-]+:[\w:-]+$/

const TOOLS = ['tsc', 'vitest', 'jest', 'eslint', 'prettier']
const OPTIONS_FREE = [
  ...PLAIN,
  '--save',
  '-S',
  '--save-dev',
  '-D',
  '-d',
  '--dev',
  '--save-exact',
  '-E',
  '--exact',
  '--save-optional',
  '-O',
  '--optional',
  '--save-peer',
  '--no-save',
  '--global',
  '-g',
  '--production',
  '--prod',
  '-P',
  '--force',
  '-f',
  '--frozen-lockfile',
  '--no-frozen-lockfile',
  '--immutable',
  '--legacy-peer-deps',
  '--omit',
  '--include',
  '--no-audit',
  '--no-fund',
  '--audit-level',
  '--fix',
  '--json',
  '--long',
  '--depth',
  '--all',
  '-a',
  '--recursive',
  '-r',
  '--filter',
  '-F',
  '--workspace',
  '-w',
  '--workspaces',
  '--workspace-root',
  '--if-present',
  '--verbose',
  '--parallel',
  '--stream',
  '--watch',
  '--coverage',
  '--bail',
  '--dry-run',
  '--offline',
  '--prefer-offline',
  '--latest',
  '-L',
  '--ignore-scripts',
  '--save-prod',
  '--loglevel',
  '--noEmit',
  '--write',
  '--check',
]
const REACH: Record<
  string,
  {
    short: RegExp | null
    long: string[]
    commands: string[]
    before: string[]
    valued: string[]
  }
> = {
  npm: {
    ...PACKAGES,
    short: null,
    commands: [
      'test',
      't',
      'run',
      'run-script',
      'start',
      'stop',
      'restart',
      'install',
      'i',
      'add',
      'ci',
      'clean-install',
      'uninstall',
      'remove',
      'rm',
      'un',
      'update',
      'up',
      'upgrade',
      'ls',
      'list',
      'll',
      'la',
      'outdated',
      'audit',
      'view',
      'info',
      'show',
      'pack',
      'help',
      'root',
      'prefix',
      'why',
      'explain',
      'dedupe',
      'prune',
      'rebuild',
      'version',
    ],
    before: PLAIN,
    valued: ['--prefix', '-w', '--workspace'],
  },
  pnpm: {
    ...PACKAGES,
    short: null,
    commands: [
      't',
      'run',
      'install',
      'i',
      'add',
      'remove',
      'rm',
      'uninstall',
      'un',
      'update',
      'up',
      'upgrade',
      'list',
      'ls',
      'll',
      'la',
      'outdated',
      'audit',
      'why',
      'view',
      'info',
      'prune',
      'rebuild',
      'dedupe',
      'pack',
      'root',
      'help',
    ],
    before: [...PLAIN, '-r', '--recursive', '-w', '--workspace-root'],
    valued: ['--filter', '-F', '--dir', '-C'],
  },
  yarn: {
    ...PACKAGES,
    short: null,
    commands: [
      'run',
      'install',
      'add',
      'remove',
      'upgrade',
      'up',
      'list',
      'info',
      'why',
      'outdated',
      'audit',
      'pack',
      'help',
    ],
    before: PLAIN,
    valued: ['--cwd'],
  },
  bun: {
    short: /^-[a-zA-Z]*[ep]/,
    long: [...PACKAGES.long, '--eval', '--print'],
    commands: ['install', 'i', 'add', 'a', 'remove', 'rm', 'update', 'outdated', 'help'],
    before: PLAIN.filter((one) => one !== '-s'),
    valued: ['--cwd'],
  },
}

const RUNS_WHAT_IT_FETCHES = new Set(['npx', 'pnpx', 'bunx'])

interface Free {
  flags?: string
  valued?: string
  long?: readonly string[]
}

const LOOKS = [
  '--oneline',
  '--graph',
  '--decorate',
  '--no-decorate',
  '--stat',
  '--shortstat',
  '--numstat',
  '--name-only',
  '--name-status',
  '--patch',
  '--no-patch',
  '--color',
  '--no-color',
  '--format',
  '--pretty',
  '--abbrev-commit',
  '--date',
  '--author',
  '--grep',
  '--since',
  '--until',
  '--after',
  '--before',
  '--all',
  '--follow',
  '--reverse',
  '--max-count',
  '--first-parent',
  '--merges',
  '--no-merges',
  '--cached',
  '--staged',
  '--word-diff',
  '--ignore-all-space',
  '--unified',
]
const GIT_BEFORE = [
  '--version',
  '--help',
  '-v',
  '-h',
  '-P',
  '--no-pager',
  '--no-optional-locks',
  '--no-replace-objects',
  '--literal-pathspecs',
]
const GIT: Record<string, Free> = {
  status: {
    flags: 'sbu',
    long: ['--short', '--branch', '--long', '--porcelain', '--untracked-files', '--ignored'],
  },
  log: { flags: 'p', valued: 'n', long: LOOKS },
  show: { flags: 'ps', long: LOOKS },
  diff: { flags: 'pwb', valued: 'U', long: LOOKS },
  blame: { flags: 'wsl', valued: 'L' },
  shortlog: { flags: 'sne', long: ['--summary', '--numbered', '--email', '--all'] },
  reflog: { valued: 'n', long: ['--oneline', '--all'] },
  describe: { long: ['--tags', '--always', '--abbrev', '--dirty', '--long', '--exact-match'] },
  'rev-parse': {
    long: [
      '--abbrev-ref',
      '--short',
      '--verify',
      '--show-toplevel',
      '--git-dir',
      '--is-inside-work-tree',
    ],
  },
  'ls-files': {
    flags: 'cdmost',
    long: ['--cached', '--deleted', '--modified', '--others', '--stage', '--exclude-standard'],
  },
  add: {
    flags: 'Aunvpf',
    long: ['--all', '--update', '--dry-run', '--verbose', '--patch', '--force', '--intent-to-add'],
  },
  rm: { flags: 'rfqn', long: ['--cached', '--force', '--quiet', '--dry-run'] },
  mv: { flags: 'fkvn', long: ['--force', '--dry-run', '--verbose'] },
  commit: {
    flags: 'asqv',
    valued: 'm',
    long: [
      '--all',
      '--amend',
      '--message',
      '--no-edit',
      '--signoff',
      '--no-verify',
      '--allow-empty',
      '--quiet',
      '--verbose',
    ],
  },
  push: {
    flags: 'uqvnfd',
    long: [
      '--set-upstream',
      '--force',
      '--force-with-lease',
      '--tags',
      '--follow-tags',
      '--dry-run',
      '--delete',
      '--quiet',
      '--verbose',
      '--no-verify',
    ],
  },
  pull: {
    flags: 'qv',
    long: [
      '--rebase',
      '--no-rebase',
      '--ff-only',
      '--no-ff',
      '--ff',
      '--quiet',
      '--verbose',
      '--tags',
    ],
  },
  fetch: {
    flags: 'qvp',
    long: [
      '--all',
      '--prune',
      '--tags',
      '--depth',
      '--quiet',
      '--verbose',
      '--no-tags',
      '--unshallow',
    ],
  },
  checkout: {
    flags: 'qf',
    valued: 'bB',
    long: ['--quiet', '--force', '--track', '--ours', '--theirs'],
  },
  switch: {
    flags: 'qf',
    valued: 'cC',
    long: ['--create', '--detach', '--quiet', '--force', '--track'],
  },
  restore: { flags: 'SWq', valued: 's', long: ['--staged', '--worktree', '--source', '--quiet'] },
  reset: { flags: 'q', long: ['--soft', '--mixed', '--hard', '--keep', '--merge', '--quiet'] },
  branch: {
    flags: 'avrdDmMf',
    long: [
      '--all',
      '--verbose',
      '--remotes',
      '--delete',
      '--move',
      '--list',
      '--merged',
      '--no-merged',
      '--show-current',
      '--force',
    ],
  },
  tag: {
    flags: 'adlf',
    valued: 'm',
    long: ['--annotate', '--delete', '--list', '--message', '--force', '--sort'],
  },
  merge: {
    flags: 'q',
    valued: 'm',
    long: [
      '--no-ff',
      '--ff',
      '--ff-only',
      '--squash',
      '--abort',
      '--continue',
      '--no-edit',
      '--message',
      '--quiet',
    ],
  },
  rebase: {
    flags: 'q',
    long: ['--continue', '--abort', '--skip', '--onto', '--autostash', '--quiet'],
  },
  'cherry-pick': { flags: 'xn', long: ['--continue', '--abort', '--skip', '--no-commit'] },
  revert: { flags: 'n', long: ['--continue', '--abort', '--no-edit', '--no-commit'] },
  stash: { flags: 'um', long: ['--include-untracked', '--message'] },
  remote: { flags: 'v', long: ['--verbose'] },
  clone: {
    flags: 'q',
    valued: 'b',
    long: ['--depth', '--branch', '--single-branch', '--quiet', '--no-tags', '--filter', '--bare'],
  },
  init: { flags: 'q', valued: 'b', long: ['--initial-branch', '--bare', '--quiet'] },
  worktree: { flags: 'fq', valued: 'bB', long: ['--force', '--detach', '--quiet'] },
  help: {},
}

function gitOptionFree(word: string, free: Free): boolean {
  if (word.startsWith('--')) return (free.long ?? []).includes(word.split('=')[0] ?? word)
  if (/^-\d+$/.test(word)) return free.valued?.includes('n') === true

  for (const letter of word.slice(1)) {
    if (free.valued?.includes(letter)) return true
    if (!free.flags?.includes(letter)) return false
  }
  return word.length > 1
}

function gitStays(plain: readonly string[]): boolean {
  const at = plain.findIndex((word) => !word.startsWith('-'))
  const leading = at === -1 ? plain : plain.slice(0, at)
  if (!leading.every((word) => GIT_BEFORE.includes(word))) return false

  const command = plain[at]
  if (command === undefined) return true
  const free = Object.hasOwn(GIT, command) ? GIT[command] : undefined
  if (!free) return false

  for (const word of plain.slice(at + 1)) {
    if (word === '--') return true
    if (word.startsWith('-') && !gitOptionFree(word, free)) return false
  }
  return true
}

function wordsOf(line: string): string[] | null {
  const words: string[] = []
  let word: string | null = null
  let quote: '"' | "'" | null = null

  for (let at = 0; at < line.length; at++) {
    const one = line.charAt(at)
    if (quote === "'") {
      if (one === "'") quote = null
      else word = (word ?? '') + one
    } else if (quote === '"') {
      if (one === '"') quote = null
      else if (one === '\\' && /["\\$`]/.test(line.charAt(at + 1)))
        word = (word ?? '') + line.charAt(++at)
      else word = (word ?? '') + one
    } else if (one === '"' || one === "'") {
      quote = one
      word ??= ''
    } else if (one === '\\') {
      word = (word ?? '') + line.charAt(++at)
    } else if (one === ' ' || one === '\t') {
      if (word !== null) words.push(word)
      word = null
    } else {
      word = (word ?? '') + one
    }
  }

  if (quote !== null) return null
  if (word !== null) words.push(word)
  return words
}

function bareNameStays(program: string, plain: readonly string[], at: number): boolean {
  const command = plain[at] ?? ''
  if (program === 'bun') {
    if (command === 'test' || command === 'build') return true
    const named = command === 'run' ? (plain[at + 1] ?? '') : command
    const past = command === 'run' ? at + 2 : at + 1
    if (SCRIPT_BY_SHAPE.test(named)) return true
    return SCRIPTS.includes(named) && !positional(plain, past)
  }
  if (program !== 'pnpm' && program !== 'yarn') return false
  if (SCRIPT_BY_SHAPE.test(command) || TOOLS.includes(command)) return true
  return SCRIPTS.includes(command) && (command === 'test' || !positional(plain, at + 1))
}

function positional(plain: readonly string[], from: number): boolean {
  const end = plain.indexOf('--', from)
  return plain.slice(from, end === -1 ? undefined : end).some((word) => !word.startsWith('-'))
}

function argumentsStay(program: string, plain: readonly string[]): boolean {
  if (RUNS_WHAT_IT_FETCHES.has(program)) return false

  if (program === 'git') return gitStays(plain)

  const reach = REACH[program]
  if (!reach) return true

  let at = 0
  for (; at < plain.length; at++) {
    const word = plain[at] ?? ''
    if (!word.startsWith('-')) break
    if (reach.before.includes(word)) continue
    if (reach.valued.includes(word.split('=')[0] ?? word)) {
      if (!word.includes('=')) {
        at += 1
        if (at === plain.length) return false
      }
      if (/\s/.test(word) || /\s/.test(plain[at] ?? '')) return false
      continue
    }
    return false
  }

  if (program === 'yarn' && plain[at] === 'workspace') {
    at += 2
    if (at >= plain.length) return false
  }
  const command = plain[at]
  if (command !== undefined) {
    if (!reach.commands.includes(command) && !bareNameStays(program, plain, at)) return false
  }

  const end = plain.indexOf('--', at)
  for (const word of plain.slice(at + 1, end === -1 ? undefined : end)) {
    if (word.startsWith('-') && !OPTIONS_FREE.includes(word.split('=')[0] ?? word)) return false
  }

  return !plain.some((word) => {
    if (word.startsWith('--')) {
      const name = word.split('=')[0] ?? word
      return name.length > 2 && reach.long.some((one) => one.startsWith(name))
    }
    return reach.short?.test(word) === true
  })
}

export function onTheList(command: string, programs: readonly string[], os: Os): boolean {
  const program = programOf(command, os)
  if (program === '' || !programs.some((one) => programOf(one, os) === program)) return false

  if (/(?! )\p{Zs}/u.test(command)) return false

  const words = wordsOf(command.trim())
  return words !== null && argumentsStay(program.toLowerCase(), words.slice(1))
}

/** Whether a line starts only its first program: no second command after a `;`, an
 *  `&` or a `|`, nothing run inside it with backticks, `$(`, `(` or PowerShell's `@{`, no
 *  file written or read with `>` or `<`, nothing out of the history with `!`, and no word
 *  the shell makes into others (`$X`, `{a,b}`, `*`, `?`, `[`), which is how an option gets
 *  past the list of them in `onTheList`. Only such a line can be
 *  let through for being on an agent's list; `git status; rm -rf ~` starts `git` and is
 *  not one. Nor is a line with a control or a separator character anywhere: typed into a
 *  shell, Ctrl+U clears what came before it, Ctrl+O runs it, a backspace rubs it out and
 *  a tab completes it, so the words before Enter are not the words that run. */
export function startsOnlyOne(command: string): boolean {
  return !/[;&|`<>!(){}$*?[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|(?! )\p{Zs}/u.test(command)
}

/** What a terminal printed, as words: the escapes that colour and move things on a
 *  screen taken out, a carriage return taken out, and nothing else changed. */
export function plainOf(printed: string): string {
  let out = ''

  for (let at = 0; at < printed.length; at++) {
    const code = printed.charCodeAt(at)
    if (code === 27) {
      const next = printed[at + 1]
      if (next === '[') {
        // Control sequence: parameters, then one final character.
        at += 2
        while (at < printed.length && !/[@-~]/.test(printed[at] ?? '')) at++
      } else if (next === ']') {
        // Operating system command, ended by a bell or by ESC \.
        at += 2
        while (at < printed.length) {
          if (printed.charCodeAt(at) === 7) break
          if (printed.charCodeAt(at) === 27 && printed[at + 1] === '\\') {
            at++
            break
          }
          at++
        }
      } else at++
      continue
    }

    if (code === 10 || code === 9 || code >= 32) out += printed[at] ?? ''
  }

  return out
}
