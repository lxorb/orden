import { describe, expect, test } from 'vitest'
import { renderMarkdown } from '@orden/markdown'
import { blocksOf, sectionOf } from '@orden/markdown/links'
import { applied } from '@orden/scan/search/replace'
import { resolve } from './anchors'
import { plan, readEdits } from './edits'

function edited(text: string, edits: unknown): string {
  return applied(text, plan(readEdits(edits), text).edits)
}
const STEPS = '1. Install\n2. Run:\n\n   ```sh\n   make\n   ```\n\n   ^cmd\n\n3. Done\n'
describe('a code block inside a numbered step, named by Copy link', () => {
  test('replaced keeps the steps above it', () => {
    const after = edited(STEPS, [{ at: { block: 'cmd' }, replace: '```sh\nmake all\n```' }])
    expect(after).toContain('make all')
    expect(after).toContain('1. Install')
    expect(after).toContain('2. Run:')
  })
  test('deleted keeps the steps above it', () => {
    const after = edited(STEPS, [{ at: { block: 'cmd' }, delete: true }])
    expect(after).toContain('1. Install')
    expect(after).toContain('2. Run:')
  })
  test('starts where the read hands its line', () => {
    const listed = blocksOf(STEPS).find((one) => one.id === 'cmd')
    const lines = STEPS.split('\n')
    const place = resolve({ block: 'cmd' }, STEPS)
    expect(STEPS.slice(place.from).startsWith(lines[listed?.line ?? 0] ?? '')).toBe(true)
  })
  test('embedded shows the code block, not the list', () => {
    const shown = sectionOf(STEPS, { heading: null, block: 'cmd' }) ?? ''
    expect(shown).toContain('make')
    expect(shown).not.toContain('Install')
  })
})
describe('the last item of a list named at its end, deleted', () => {
  test('leaves the paragraph under the list a paragraph', () => {
    const text = '- milk\n- eggs ^eg\n\nShop opens at nine.\n'
    const html = renderMarkdown(edited(text, [{ at: { block: 'eg' }, delete: true }]))
    expect(html).toContain('<p>Shop opens at nine.</p>')
  })
  test('leaves the paragraph under a numbered list a paragraph', () => {
    const text = '1. one\n2. two ^tw\n\nAfter.\n'
    const html = renderMarkdown(edited(text, [{ at: { block: 'tw' }, delete: true }]))
    expect(html).toContain('<p>After.</p>')
  })
})
describe('words inserted beside a list item named at its end', () => {
  test('before a middle item do not join the item above', () => {
    const text = '- milk\n- eggs ^eg\n- bread\n'
    const html = renderMarkdown(edited(text, [{ at: { block: 'eg' }, insert_before: 'Note' }]))
    expect(html).toContain('<li>milk</li>')
    expect(html).toContain('<p>Note</p>')
  })
  test('after a numbered item keep the items below a list', () => {
    const text = '1. one ^on\n2. two\n3. three\n'
    const html = renderMarkdown(edited(text, [{ at: { block: 'on' }, insert_after: 'Note' }]))
    expect(html).toContain('<p>Note</p>')
    expect(html).toContain('<li>two</li>')
  })
})
describe('a list named by an id on its own line after a blank', () => {
  test('is listed by the read from the line its edits start at', () => {
    const text = 'x\n\n- a\n- b\n\n^lst\n\ny'
    const listed = blocksOf(text).find((one) => one.id === 'lst')
    const place = resolve({ block: 'lst' }, text)
    expect(listed?.line).toBe(2)
    expect(text.slice(place.from).startsWith('- a')).toBe(true)
  })
})
describe('a block inside a list item, replaced by unindented words', () => {
  test('a nested item stays nested', () => {
    const text = '- a\n  - b ^i\n- c\n'
    expect(edited(text, [{ at: { block: 'i' }, replace: '- NEW' }])).toBe('- a\n  - NEW ^i\n- c\n')
  })
  test('a second paragraph stays in its item', () => {
    const text = '- a\n\n  more ^i\n\n- c\n'
    const html = renderMarkdown(edited(text, [{ at: { block: 'i' }, replace: 'fresh' }]))
    expect(html).not.toContain('<p>fresh</p>\n<ul>')
    expect(html).toMatch(/<li>[\s\S]*fresh[\s\S]*<\/li>/)
  })
})
