import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')
test('no file reaches the agent modules, which the web and the phone leave out', () => {
  const reaching = readdirSync(SRC)
    .filter((name) => !name.includes('.test.'))
    .filter((name) =>
      /from '\.\.\/\.\.\/agent-(?:verbs|host|docs)\/|import\('\.\.\/\.\.\/agent-/.test(
        readFileSync(join(SRC, name), 'utf8'),
      ),
    )
  expect(reaching).toEqual([])
  const protocol = readdirSync(SRC)
    .filter((name) => !name.includes('.test.'))
    .flatMap((name) => readFileSync(join(SRC, name), 'utf8').split('\n'))
    .filter((line) => line.includes('agent-protocol'))
  expect(protocol.every((line) => line.startsWith('import type '))).toBe(true)
})
test('the api leaves the todos, the bases and the port behind doors', () => {
  const text = readFileSync(join(SRC, 'api.ts'), 'utf8')
  expect(text).not.toMatch(/from '\.\/(?:todos|bases|reader)'/)
})
