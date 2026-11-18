import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

const section = (source: string, block: string) => sectionOf(source, { heading: null, block })

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
