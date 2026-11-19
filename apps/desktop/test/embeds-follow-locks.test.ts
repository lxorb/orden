import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { svelte, walk } from './files'

const SOURCE = fileURLToPath(new URL('../src/lib/', import.meta.url))
const DRAWS =
  /import \{[^}]*\b(?:readingHtml|fileSource)\b[^}]*\} from '[./]+(?:\w+\/)*(?:reading\/src\/api|plane\/src\/api|render)'/
describe('a view that draws what a note embeds', () => {
  test('draws again when a lock opens or shuts', () => {
    const drawing = walk(SOURCE, svelte).filter((path) => DRAWS.test(readFileSync(path, 'utf8')))
    expect(drawing.length).toBeGreaterThan(2)
    const deaf = drawing
      .filter((path) => !readFileSync(path, 'utf8').includes('links.locksSeen()'))
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    expect(deaf).toEqual([])
  })
})
