import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('.', import.meta.url))
const DRAWS =
  /import \{[^}]*\b(?:readingHtml|fileSource)\b[^}]*\} from '[./]+(?:\w+\/)*(?:reading|canvas)\/render'/

function views(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return views(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

describe('a view that draws what a note embeds', () => {
  test('draws again when a lock opens or shuts', () => {
    const drawing = views(SOURCE).filter((path) => DRAWS.test(readFileSync(path, 'utf8')))
    expect(drawing.length).toBeGreaterThan(2)
    const deaf = drawing
      .filter((path) => !readFileSync(path, 'utf8').includes('links.locksSeen()'))
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    expect(deaf).toEqual([])
  })
})
