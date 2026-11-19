import type { PickedFile } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import {
  detect,
  folderNameFor,
  insideFolder,
  pickedFolder,
  safeName,
  sourcesFrom,
  titleFrom,
  tooMuch,
} from '../src/api'

const words = (body: string) => new TextEncoder().encode(body)
function picked(path: string, body: string): PickedFile {
  const bytes = words(body)
  return {
    name: path.split('/').pop() ?? path,
    webkitRelativePath: path,
    arrayBuffer: async () => bytes.slice().buffer,
  }
}
describe('what was picked', () => {
  test('a picked folder is named once and its files are read from inside it', () => {
    const files = [picked('Notes/a.md', '# A'), picked('Notes/sub/b.md', 'b')]
    expect(pickedFolder(files)).toBe('Notes')
    expect(insideFolder(files).map((one) => one.webkitRelativePath)).toEqual(['a.md', 'sub/b.md'])
  })
  test('a folder of markdown is read as markdown', async () => {
    const sources = await sourcesFrom(insideFolder([picked('Notes/a.md', '# A\n\nwords')]))
    expect(sources.map((one) => one.path)).toEqual(['a.md'])
    expect(await detect(sources)).not.toBeNull()
    expect(await detect([])).toBeNull()
  })
  test('a file too large to bring in is refused', () => {
    expect(tooMuch(0)).toBe(false)
    expect(tooMuch(Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})
describe('names', () => {
  test('a note is titled by its first heading and named without forbidden characters', () => {
    expect(titleFrom('\n# Plan\nmore')).toBe('Plan')
    expect(safeName('a/b: c?')).not.toMatch(/[/:?]/)
  })
  test('an import folder is named after what was picked, or the app an export came out of', () => {
    expect(folderNameFor([picked('Travel.enex', '')], 'evernote')).toBe('Travel')
    expect(folderNameFor([picked('Export-9f1c2d3e.zip', '')], 'notion')).toBe('Notion')
    expect(folderNameFor([picked('a.csv', '')], 'todoist')).toBe('')
  })
})
