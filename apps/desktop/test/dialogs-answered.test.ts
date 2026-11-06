import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = join(fileURLToPath(new URL('..', import.meta.url)), 'src')

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path)
    const code =
      (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) &&
      !entry.name.endsWith('.test.ts')
    return code ? [path] : []
  })
}

describe('a file dialog', () => {
  test('is answered by an agent’s path wherever one is opened', () => {
    const opening = sources(SOURCE).filter((path) =>
      readFileSync(path, 'utf8').includes("'@tauri-apps/plugin-dialog'"),
    )
    expect(opening.length).toBeGreaterThan(0)
    const unanswered = opening
      .filter((path) => !readFileSync(path, 'utf8').includes('dialogAnswer()'))
      .map((path) => relative(SOURCE, path))
    expect(unanswered).toEqual([])
  })
})
