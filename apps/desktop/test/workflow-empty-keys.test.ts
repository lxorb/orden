import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const WORKFLOWS = fileURLToPath(new URL('../../../.github/workflows/', import.meta.url))
const MAY_BE_EMPTY = new Set(['workflow_dispatch', 'workflow_call', 'merge_group'])

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function emptyMappings(text: string): string[] {
  const lines = text.split('\n')
  const found: string[] = []
  lines.forEach((line, index) => {
    const key = /^(\s*)(?:- )?([\w-]+):\s*$/.exec(line)
    if (!key || MAY_BE_EMPTY.has(key[2] ?? '')) return
    const next = lines
      .slice(index + 1)
      .find((candidate) => candidate.trim() !== '' && !candidate.trim().startsWith('#'))
    if (next === undefined || indentOf(next) <= indentOf(line))
      found.push(`${index + 1}: ${line.trim()}`)
  })
  return found
}

describe('GitHub workflows', () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name))

  test('are found', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  test.each(files)('%s has no key left without a value', (name) => {
    expect(emptyMappings(readFileSync(join(WORKFLOWS, name), 'utf8'))).toEqual([])
  })

  test('a key emptied by deleting its only entry is caught', () => {
    expect(emptyMappings('env:\n\njobs:\n  a:\n    runs-on: x\n')).toEqual(['1: env:'])
  })
})
