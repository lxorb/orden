import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { spaceHolding } from './space-paths'

const LIB = join(import.meta.dirname, '..', '..')
const sources = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
describe('the space that holds a path', () => {
  const spaces = [
    { id: 'notes', root: '/home/me/Notes' },
    { id: 'work', root: '/home/me/Work' },
  ]
  test('is the one whose folder the path is in', () => {
    expect(spaceHolding(spaces, '/home/me/Work/plan.md')?.id).toBe('work')
    expect(spaceHolding(spaces, '/home/me/Notes')?.id).toBe('notes')
  })
  test('is none for a path outside every space, or beside one with a longer name', () => {
    expect(spaceHolding(spaces, '/home/me/Downloads/a.md')).toBeNull()
    expect(spaceHolding(spaces, '/home/me/Notes old/a.md')).toBeNull()
  })
  test('is asked in one place only', () => {
    const copies = sources(LIB)
      .filter((file) => /\.(?:find|some)\(\s*\((\w+)\) =>\s*within\(\1\.root,/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(LIB, file))
    expect(copies).toEqual(['platform/src/space-paths.ts'])
  })
})
