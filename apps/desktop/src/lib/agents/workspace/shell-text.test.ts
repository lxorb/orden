import { describe, expect, test } from 'vitest'
import { onTheList, plainOf, programOf, startsOnlyOne } from './shell-text'

const ESC = String.fromCharCode(27)
const BELL = String.fromCharCode(7)

describe('the program a command starts', () => {
  test('is the first word, in lower case', () => {
    expect(programOf('git status --short')).toBe('git')
    expect(programOf('  Git status')).toBe('git')
    expect(programOf('node build.mjs')).toBe('node')
  })

  test('is the only one a line starts, or the line is not let through for it', () => {
    expect(startsOnlyOne('git status --short')).toBe(true)
    for (const line of [
      'git status; rm -rf ~',
      'git log && curl x',
      'git log || curl x',
      'git log | sh',
      'git log & calc',
      'git log > ~/.bashrc',
      'git log $(whoami)',
      'git log `whoami`',
    ]) {
      expect(startsOnlyOne(line), line).toBe(false)
    }
  })
})

describe('what a terminal printed', () => {
  test('comes back as its words, the colours, titles and carriage returns taken out', () => {
    const printed = `${ESC}]0;title${BELL}${ESC}[32mok${ESC}[0m\r\nnext ${ESC}[2K${ESC}]8;;x${ESC}\\line\tend\r\n`
    expect(plainOf(printed)).toBe('ok\nnext line\tend\n')
  })
})

describe('what actually runs', () => {
  test('a word with a folder, an ending or a quote is no program on a list', () => {
    for (const line of [
      '/tmp/x/git.sh',
      './git status',
      '../git',
      '~/git',
      'C:\\tools\\git.exe log',
      '"C:\\Program Files\\Git\\bin\\git.exe" log',
      "'git' status",
      '"git"/../../bin/sh',
      '\\git status',
      'git.sh',
      'git.exe status',
      'git$IFS-x',
      'FOO=1 git status',
    ]) {
      expect(['git'], line).not.toContain(programOf(line))
    }
  })

  test('a line with a control character starts more than it says', () => {
    for (const line of [
      'git \u0015touch pwned',
      'git status \u000ftouch x',
      'git status\u0008\u0008touch x',
      'git status\u007f\u007ftouch x',
      'git status\ttouch',
      'git \u001b[Atouch',
      'git status\u0085touch',
      'git status\u2028touch',
    ]) {
      expect(startsOnlyOne(line), JSON.stringify(line)).toBe(false)
    }
  })

  test('nor does history or a subexpression run under the first word', () => {
    for (const line of ['git !!', 'git !-1', 'git (rm x)']) {
      expect(startsOnlyOne(line), line).toBe(false)
    }
  })
})

describe('what a listed program is told to run', () => {
  test('git’s config, exec and output options ask', () => {
    for (const line of [
      'git -c core.fsmonitor="touch x" status',
      'git -p -c core.pager=touch status',
      'git --paginate log',
      'git -C /tmp/x status',
      'git --config-env=core.pager=X log',
      'git --exec-path=/tmp/x status',
      'git --git-dir=/tmp/x/.git status',
      'git --work-tree=/tmp/x status',
      'git log --output=/home/me/.bashrc',
      'git log --outp=/home/me/.bashrc',
      'git diff --ext-diff',
      'git fetch --upload-pack=touch origin',
      'git rebase -x touch',
      'git rebase --exec=touch',
      'git grep -Ovim x',
      'git grep --open-files-in-pager=touch x',
      'git difftool -x touch',
      'git config core.pager touch',
      'git submodule foreach touch',
      'git bisect run touch',
      'git "-c" core.pager=touch log',
      "git -'c' core.pager=touch log",
      'git --out""put=x log',
      'git -\\c core.pager=touch log',
    ]) {
      expect(onTheList(line, ['git']), line).toBe(false)
    }
  })

  test('npm and its kind ask before they fetch and run', () => {
    for (const [line, program] of [
      ['npm exec touch', 'npm'],
      ['npm x touch', 'npm'],
      ['npm explore x', 'npm'],
      ['npm test --script-shell=/tmp/x', 'npm'],
      ['npx touch', 'npx'],
      ['pnpm dlx touch', 'pnpm'],
      ['pnpm exec touch', 'pnpm'],
      ['pnpx touch', 'pnpx'],
      ['yarn dlx touch', 'yarn'],
      ['bunx touch', 'bunx'],
    ] as const) {
      expect(onTheList(line, [program]), line).toBe(false)
    }
  })

  test('what they do every day goes', () => {
    for (const [line, program] of [
      ['git status --short', 'git'],
      ['git log --oneline -5', 'git'],
      ['git diff HEAD~1 -- src/a.ts', 'git'],
      ['git commit -m fix', 'git'],
      ['npm test', 'npm'],
      ['pnpm run build', 'pnpm'],
    ] as const) {
      expect(onTheList(line, [program]), line).toBe(true)
    }
  })

  test('expansion that builds an option under the first word asks', () => {
    for (const line of [
      'git @{a=calc}',
      'git {-c,core.pager=touch} log',
      'git x$IFS-c',
      'git $X',
      'git log *',
      'git log ?c',
      'git log [-]c',
    ]) {
      expect(startsOnlyOne(line), line).toBe(false)
    }
  })
})
