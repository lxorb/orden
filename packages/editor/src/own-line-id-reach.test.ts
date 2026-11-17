import { blocksOf, sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

const section = (source: string, block: string) => sectionOf(source, { heading: null, block })

describe('an id on the line right under a list item, with no blank line between', () => {
  test('names that item, as the block search and reading view do, not the whole list', () => {
    const source = '- milk\n- eggs\n^eggs\n'
    expect(blocksOf(source).find((block) => block.id === 'eggs')?.text).toBe('eggs')
    expect(section(source, 'eggs')).toBe('- eggs')
  })

  test('names the nested item it sits under, not its parent and siblings', () => {
    expect(section('- plan\n  - call the bank\n  ^bank\n- book\n', 'bank')).toBe('- call the bank')
  })
})

describe('an id on its own line under a list with blank lines between its items', () => {
  test('names the whole list, not just the last item', () => {
    const shown = section('- milk\n\n- eggs\n\n- bread\n\n^groceries\n', 'groceries')
    expect(shown).toContain('- milk')
    expect(shown).toContain('- eggs')
    expect(shown).toContain('- bread')
  })

  test('starts at the first item when an item holds a second paragraph', () => {
    const shown = section('- milk\n\n  the oat one\n- eggs\n\n^groceries\n', 'groceries')
    expect(shown?.startsWith('- milk')).toBe(true)
  })
})
