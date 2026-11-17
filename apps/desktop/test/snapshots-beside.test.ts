import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { expect, test } from 'vitest'

const ROOT = join(import.meta.dirname, '../../..')

test('every kept snapshot sits beside the test that checks it, so a moved test cannot rewrite it unseen', () => {
  const lost = execFileSync('git', ['ls-files', '*.snap'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((path) => !existsSync(join(ROOT, dirname(dirname(path)), basename(path, '.snap'))))
  expect(lost).toEqual([])
})
