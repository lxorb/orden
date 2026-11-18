import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { expect, test } from 'vitest'

const ROOT = join(import.meta.dirname, '../../..')

const tracked = (pattern: string) =>
  execFileSync('git', ['ls-files', pattern], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

test('every kept snapshot sits beside the test that checks it, so a moved test cannot rewrite it unseen', () => {
  const lost = tracked('*.snap').filter(
    (path) => !existsSync(join(ROOT, dirname(dirname(path)), basename(path, '.snap'))),
  )
  expect(lost).toEqual([])
})

test('every test that checks a snapshot has it kept, so CI never meets one written on the spot', () => {
  const kept = new Set(tracked('*.snap'))
  const unkept = tracked('*.test.ts')
    .filter((path) => existsSync(join(ROOT, path)))
    .filter((path) =>
      /\.(toMatchSnapshot|toThrowErrorMatchingSnapshot)\(/.test(
        readFileSync(join(ROOT, path), 'utf8'),
      ),
    )
    .filter((path) => !kept.has(`${dirname(path)}/__snapshots__/${basename(path)}.snap`))
  expect(unkept).toEqual([])
})
