import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const ROOT = join(import.meta.dirname, '../../..')
const WORKFLOWS = join(ROOT, '.github/workflows')
const RUN = /(?:apps\/desktop\/test\/e2e|scripts)\/[\w./-]+\.(?:py|mjs|sh|ts)\b/g

test('every drive and script a workflow runs is still in the repo', () => {
  const gone = readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith('.yml'))
    .flatMap((name) =>
      [...readFileSync(join(WORKFLOWS, name), 'utf8').matchAll(RUN)]
        .map(([path]) => path)
        .filter((path) => !existsSync(join(ROOT, path)))
        .map((path) => `${name}: ${path}`),
    )
  expect(gone).toEqual([])
})
