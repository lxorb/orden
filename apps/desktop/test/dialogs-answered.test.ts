import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { code, walk } from './files'

const SOURCE = join(fileURLToPath(new URL('..', import.meta.url)), 'src')

describe('a file dialog', () => {
  test('is answered by an agent’s path wherever one is opened', () => {
    const opening = walk(SOURCE, code).filter((path) =>
      readFileSync(path, 'utf8').includes("'@tauri-apps/plugin-dialog'"),
    )
    expect(opening.length).toBeGreaterThan(0)
    const unanswered = opening
      .filter((path) => !readFileSync(path, 'utf8').includes('dialogAnswer()'))
      .map((path) => relative(SOURCE, path))
    expect(unanswered).toEqual([])
  })
})
