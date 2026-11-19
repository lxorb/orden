import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

const SCRIPT = join(import.meta.dirname, '../../../scripts/release-notes.mjs')
let at = ''
afterEach(() => {
  if (at) rmSync(at, { recursive: true, force: true })
  at = ''
})
function history(steps: (string | { tag: string })[]) {
  at = mkdtempSync(join(tmpdir(), 'orden-notes-'))
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: at })
  git('init', '-q')
  for (const step of steps) {
    if (typeof step === 'string') git('commit', '-q', '--allow-empty', '-m', step)
    else git('tag', step.tag)
  }
}
const notes = (tag: string) => execFileSync('node', [SCRIPT, tag], { cwd: at, encoding: 'utf8' })
test('count the bugs fixed since the last release, each issue once, and list what is new', () => {
  history([
    'feat: the first thing (#1)',
    { tag: 'v1.0.0' },
    'fix: a tab closes (#10)',
    'fix: a tab closes on Windows too (#10)',
    'fix: a note keeps its name (#11)',
    'fix: a quiet slip',
    'test: a test of the tab (#10)',
    'feat: a QR code beside a shared link (#12)',
    'feat(pass): passwords that fill themselves',
    { tag: 'v1.0.1-beta' },
    'chore: tidy',
    { tag: 'v1.1.0' },
  ])
  expect(notes('v1.1.0')).toBe(
    [
      '**3 bugs fixed** since v1.0.0.',
      '',
      '### New',
      '',
      '- Passwords that fill themselves',
      '- A QR code beside a shared link',
      '',
    ].join('\n'),
  )
})
test('say one bug, and no list when nothing is new', () => {
  history(['feat: a start', { tag: 'v0.1.0' }, 'fix: one slip (#3)', { tag: 'v0.1.1' }])
  expect(notes('v0.1.1')).toBe('**1 bug fixed** since v0.1.0.\n')
})
test('write nothing for a tag that is not a release', () => {
  history(['feat: a start', { tag: 'v0.1.0' }, 'fix: one slip (#3)', { tag: 'v0.2.0-rc' }])
  expect(notes('v0.2.0-rc')).toBe('')
})
