import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Every file dialog a command opens can be answered by an agent's path (#1078,
 *  `run_command`'s `path`; docs/agent-native.md 8.14).
 *
 *  An agent's command never shows the reader a dialog: `dialog-answer.ts` hands the
 *  next one the path the agent named, which the crate has judged under `files`' rules.
 *  A dialog opened without asking it first is shown to the reader instead, and the
 *  agent is told its path went unused - as #1068's "Export this space as Markdown and
 *  folders" was, added after the rest. So every file that opens the system's dialog
 *  asks `dialogAnswer()` first, and a new one that does not fails here. */

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
