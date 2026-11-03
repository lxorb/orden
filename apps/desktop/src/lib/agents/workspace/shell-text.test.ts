import { describe, expect, test } from 'vitest'
import { plainOf, programOf, startsOnlyOne } from './shell-text'

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
