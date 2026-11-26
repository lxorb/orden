import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const ROOT = join(import.meta.dirname, '../../../../../..')
const FOLDERS = ['apps/desktop/test/e2e', 'scripts']
const ASKED = /importing\.stage\s*===?\s*['"]([^'"]+)['"]/g
test('a drive only ever waits for a stage the import sheet can reach', () => {
  const declared = /export type Stage = ([^\n]+)/.exec(
    readFileSync(join(import.meta.dirname, 'importing.svelte.ts'), 'utf8'),
  )
  const stages = new Set([...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((one) => one[1]))
  expect(stages.size).toBeGreaterThan(1)
  const unreachable = FOLDERS.flatMap((folder) =>
    readdirSync(join(ROOT, folder))
      .filter((name) => name.endsWith('.py'))
      .flatMap((name) =>
        [...readFileSync(join(ROOT, folder, name), 'utf8').matchAll(ASKED)]
          .map((one) => one[1] ?? '')
          .filter((stage) => !stages.has(stage))
          .map((stage) => `${folder}/${name}: ${stage}`),
      ),
  )
  expect(unreachable).toEqual([])
})
