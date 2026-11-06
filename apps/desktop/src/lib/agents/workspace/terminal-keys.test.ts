import { describe, expect, test } from 'vitest'
import { keyBytes, linesOf, type Row, shellOs, typesFreely } from './terminal-keys'

describe('keys', () => {
  test('by name, the arrows as the program in front asked for them', () => {
    expect(keyBytes(['Ctrl+C', 'Enter', 'Tab'], false)).toEqual({ bytes: '\x03\r\t' })
    expect(keyBytes(['Up', 'Left'], false)).toEqual({ bytes: '\x1b[A\x1b[D' })
    expect(keyBytes(['Up', 'Left'], true)).toEqual({ bytes: '\x1bOA\x1bOD' })
    expect(keyBytes(['Up', 'F13'], false)).toEqual({ unknown: 'F13' })
  })
})

describe('what goes without asking', () => {
  const programs = ['git', 'NPM']

  test('one command line of a program on the list, with Enter', () => {
    expect(typesFreely('git status', true, [], programs, 'unix')).toBe(true)
    expect(typesFreely('npm test', true, [], programs, 'windows')).toBe(true)
    expect(typesFreely('NPM test', true, [], programs, 'unix')).toBe(true)
    expect(typesFreely('npm test', true, [], programs, 'unix')).toBe(false)
  })

  test('a listed name given as a path is any file called that, and asks (#1078)', () => {
    for (const os of ['windows', 'unix'] as const) {
      expect(
        typesFreely('"C:\\Program Files\\Git\\bin\\git.exe" log', true, [], programs, os),
      ).toBe(false)
    }
    expect(typesFreely('/tmp/x/git log', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('./npm test', true, [], programs, 'unix')).toBe(false)
  })

  test('a name with an ending is the bare name only where Windows runs it so', () => {
    expect(typesFreely('git.exe status', true, [], programs, 'windows')).toBe(true)
    expect(typesFreely('GIT status', true, [], programs, 'windows')).toBe(true)
    expect(typesFreely('git.ps1 status', true, [], programs, 'windows')).toBe(false)
    expect(typesFreely('git.sh status', true, [], programs, 'windows')).toBe(false)
    expect(typesFreely('git.exe status', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('GIT status', true, [], programs, 'unix')).toBe(false)
  })

  test("an online terminal keeps its Linux machine's rule, from a Windows computer too", () => {
    expect(shellOs(true, 'windows')).toBe('unix')
    expect(shellOs(false, 'windows')).toBe('windows')
    expect(shellOs(false, 'linux')).toBe('unix')
    const online = shellOs(true, 'windows')
    expect(typesFreely('git.exe status', true, [], programs, online)).toBe(false)
    expect(typesFreely('GIT status', true, [], programs, online)).toBe(false)
    expect(typesFreely('git status', true, [], programs, online)).toBe(true)
  })

  test('nothing else: another program, a second command, no Enter, keys after it', () => {
    expect(typesFreely('rm -rf build', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('git \u0015touch pwned', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('git status \u000ftouch pwned', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('git\u007f\u007f\u007ftouch pwned', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('/tmp/x/git.sh', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('./git status', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('git status; rm -rf ~', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('git log | sh', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('git status', false, [], programs, 'unix')).toBe(false)
    expect(typesFreely('git status', true, ['Enter'], programs, 'unix')).toBe(false)
    expect(typesFreely('', true, [], programs, 'unix')).toBe(false)
    expect(typesFreely('', false, ['Enter'], programs, 'unix')).toBe(false)
    expect(typesFreely('', false, ['Up'], programs, 'unix')).toBe(false)
  })

  test('an interrupt alone', () => {
    expect(typesFreely('', false, ['Ctrl+C'], [], 'unix')).toBe(true)
    expect(typesFreely('', false, ['Ctrl+C', 'Ctrl+C'], [], 'unix')).toBe(true)
    expect(typesFreely('', false, [], [], 'unix')).toBe(false)
  })
})

describe('a buffer as lines', () => {
  function rows(...lines: [string, boolean?][]) {
    const all: Row[] = lines.map(([words, wrapped]) => ({
      isWrapped: wrapped ?? false,
      translateToString: () => words,
    }))
    return { length: all.length, getLine: (at: number) => all[at] }
  }

  test('wrapped rows joined, the empty rows under the last words left out', () => {
    const buffer = rows(['$ npm run build'], ['a very long li'], ['ne, wrapped', true], [''], [''])
    expect(linesOf(buffer, 0, 100)).toEqual({
      text: '$ npm run build\na very long line, wrapped',
      truncated: false,
    })
  })

  test('from a row on, and the last lines when there are more', () => {
    const buffer = rows(['one'], ['two'], ['three'], ['four'])
    expect(linesOf(buffer, 1, 100).text).toBe('two\nthree\nfour')
    expect(linesOf(buffer, 0, 2)).toEqual({ text: 'three\nfour', truncated: true })
  })
})
