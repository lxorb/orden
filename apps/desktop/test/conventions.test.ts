import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DOCS = `${ROOT}docs/`

const PATH = /`((?:apps|packages|services|scripts|spike|docs)\/[A-Za-z0-9_./*-]+)`/g

const MADE = ['apps/desktop/dist', 'apps/desktop/dist-even', 'apps/desktop/test/e2e/shots']

function exists(path: string): boolean {
  if (MADE.some((made) => path === made || path.startsWith(`${made}/`))) return true

  const star = path.indexOf('*')
  const named = star === -1 ? path : path.slice(0, path.lastIndexOf('/', star))

  return existsSync(`${ROOT}${named}`)
}

function pathsIn(name: string): string[] {
  const text = readFileSync(`${DOCS}${name}`, 'utf8')
  return [...new Set([...text.matchAll(PATH)].map((match) => match[1] ?? ''))]
}

const documents = readdirSync(DOCS)
  .filter((name) => name.endsWith('.md'))
  .sort()

describe('the paths the documents name', () => {
  test('the scan finds the documents', () => {
    expect(documents).toContain('conventions.md')
    expect(documents.length).toBeGreaterThan(10)
  })

  for (const name of documents) {
    test(`${name} points at files that are there`, () => {
      const missing = pathsIn(name).filter((path) => !exists(path))
      expect(missing, missing.join('\n')).toEqual([])
    })
  }

  test('and the map names a good many of them', () => {
    expect(pathsIn('conventions.md').length).toBeGreaterThan(40)
  })
})
