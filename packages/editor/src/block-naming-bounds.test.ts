import { namedBlock } from '@orden/markdown/block-names'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

function named(source: string, line: number): { source: string; shown: string | null } {
  const result = namedBlock(source, line, () => 'new123')
  if (!result) throw new Error('not named')
  return {
    source: result.source,
    shown: sectionOf(result.source, { heading: null, block: result.id }),
  }
}

describe('naming a block from the block completion or the block search', () => {
  test('a line of words right above a list is named, not the last item of the list', () => {
    const { shown } = named('Shopping for the week:\n- milk\n- eggs\n- bread\n', 0)
    expect(shown).toContain('Shopping for the week:')
    expect(shown).not.toContain('bread')
  })

  test('the second line of a wrapped item names that item, not the last item of the list', () => {
    const { shown } = named('- milk from the\n  corner shop\n- eggs\n- bread\n', 1)
    expect(shown).toContain('milk')
    expect(shown).not.toContain('bread')
  })

  test('a numbered step holding code keeps its list whole and shows the step', () => {
    const { source, shown } = named('1. Install it:\n   ```sh\n   npm i\n   ```\n2. Run it\n', 0)
    expect(source).not.toMatch(/^\^new123$/mu)
    expect(shown).toContain('Install it:')
  })

  test('an item whose code holds a dash line gets no id inside its code', () => {
    const { source } = named('- config:\n  ```yaml\n  - one\n  - two\n  ```\n- next\n', 0)
    expect(source).toContain('  ```yaml\n  - one\n  - two\n  ```')
  })
})
