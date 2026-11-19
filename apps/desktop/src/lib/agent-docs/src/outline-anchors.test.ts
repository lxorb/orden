import { applied } from '@orden/scan/search/replace'
import { describe, expect, test } from 'vitest'
import { resolve } from './anchors'
import { plan, readEdits } from './edits'
import { readNote } from './read'
import { deskWith } from './test-desk'

const PROJECT = [
  '# Project',
  '',
  '## Tasks',
  '',
  '- [ ] Write the brief',
  '',
  '## Week 1',
  '',
  '### Tasks',
  '',
  '- [ ] Call the printer',
  '',
].join('\n')
const LOG = [
  '## Notes',
  '',
  'first notes',
  '',
  '## Monday',
  '',
  '### Notes',
  '',
  'monday notes',
  '',
  '## Notes',
  '',
  'second notes',
  '',
].join('\n')
async function outlineOf(text: string) {
  const read = await readNote(deskWith({ 'note.md': text }).desk, { path: 'note.md' })
  return read.outline ?? []
}
describe('the outline an agent reads, when a heading has a namesake deeper under a sibling', () => {
  test('hands an anchor that names the Tasks section right under the top heading', async () => {
    const lines = PROJECT.split('\n')
    for (const row of await outlineOf(PROJECT)) {
      const place = resolve(row.anchor, PROJECT)
      expect(PROJECT.slice(place.from).startsWith(lines[row.line] ?? '')).toBe(true)
    }
  })
  test('deleting the second Notes section by its outline anchor keeps the Monday notes', async () => {
    const second = (await outlineOf(LOG)).filter((row) => row.title === 'Notes').at(-1)
    const after = applied(LOG, plan(readEdits([{ at: second?.anchor, delete: true }]), LOG).edits)
    expect(after).toContain('monday notes')
    expect(after).not.toContain('second notes')
  })
})
