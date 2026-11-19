import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ROOT, walk } from './files'
import { frontMatterValue, stripFrontMatter } from '@orden/markdown/front-matter'
import { openerFor } from '../src/lib/workspace/src/openers'
import { kindOfName } from '../src/lib/sync-client/src/create'
import { webUrlOf } from '../src/lib/web-tab/src/note'

const OLD_MEETING = `---
date: 2026-09-12
duration: 4:09
---

# Meeting 2026-09-12 1432

![[recording-2026-09-12-1432.weba]]

*Written by gpt-6-astra*

## Takeaways

- The fonts are decided

## Transcript (German)
*Written by whisper*

Guten Morgen, wir fangen an.
`

const PATH = 'Work/Meeting 2026-09-12 1432.md'

describe('a meeting note already on a disk', () => {
  test('opens as a note, in the app and in the plugin', () => {
    const isUrlNote = () => webUrlOf(OLD_MEETING) !== null
    expect(openerFor(PATH, isUrlNote, { evenBuild: false, isPlugin: false })).toBe('note')
    expect(openerFor(PATH, isUrlNote, { evenBuild: true, isPlugin: true })).toBe('note')
  })

  test('syncs as a note', () => {
    expect(kindOfName('Meeting 2026-09-12 1432.md')).toBe('note')
  })

  test('keeps its front matter as two plain keys', () => {
    expect(frontMatterValue(OLD_MEETING, 'date')).toBe('2026-09-12')
    expect(frontMatterValue(OLD_MEETING, 'duration')).toBe('4:09')
    expect(frontMatterValue(OLD_MEETING, 'kind')).toBeNull()
    expect(stripFrontMatter(OLD_MEETING).trimStart().startsWith('# Meeting')).toBe(true)
  })
})

const APP = join(ROOT, 'apps/desktop/src')

const read = (path: string) => readFileSync(path, 'utf8')

describe('no surface offers to make one', () => {
  test('no row of the app carries the id or the words', () => {
    const source = walk(
      APP,
      (path) => /\.(ts|svelte)$/.test(path) && !path.endsWith('.test.ts') && !/[\\/]locales[\\/]/.test(path),
    )
    const offering = source.filter((path) =>
      /'meeting'|Meeting notes|Stop the meeting|canTakeMeetingNotes/.test(read(path)),
    )
    expect(offering).toEqual([])
  })

  test('no agent tool offers the kind', () => {
    const tools = read(join(ROOT, 'apps/desktop/src-tauri/crates/ai/src/mcp/tools.json'))
    expect(tools.toLowerCase()).not.toContain('meeting')
  })

  test('the account offers no meeting summary', () => {
    const routes = read(join(ROOT, 'services/sync/src/sync-server-machines/src/ask/index.ts'))
    expect(routes).not.toContain("'/summary'")
  })
})
