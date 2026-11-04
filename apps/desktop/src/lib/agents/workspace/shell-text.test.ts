import { describe, expect, test } from 'vitest'
import { onTheList, plainOf, programOf, startsOnlyOne } from './shell-text'

const ESC = String.fromCharCode(27)
const BELL = String.fromCharCode(7)

describe('the program a command starts', () => {
  test('is the first word without its folder, its ending or its case', () => {
    expect(programOf('git status --short')).toBe('git')
    expect(programOf('  "C:\\Program Files\\nodejs\\node.exe" build.mjs')).toBe('node')
    expect(programOf('./scripts/Run.SH now')).toBe('run')
    expect(programOf('pnpm.cmd test')).toBe('pnpm')
  })

  test('is on the list only named bare, never by a path that happens to end in it', () => {
    const programs = ['git', 'Node']
    expect(onTheList(programs, 'git status')).toBe(true)
    expect(onTheList(programs, 'GIT.exe log')).toBe(true)
    expect(onTheList(programs, 'node build.mjs')).toBe(true)
    expect(onTheList(programs, 'npm test')).toBe(false)
    for (const line of [
      '/tmp/x/git status',
      './git status',
      'bin/git status',
      '~/bin/git status',
      '"C:\\Users\\me\\Downloads\\git.exe" status',
      '..\\git status',
      'PATH=/tmp/x git status',
      'GIT_SSH_COMMAND=evil git fetch',
    ]) {
      expect(onTheList(programs, line), line).toBe(false)
    }
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
