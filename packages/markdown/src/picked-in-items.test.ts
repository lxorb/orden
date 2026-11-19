import { describe, expect, test } from 'vitest'
import { namedBlock } from './block-names'
import { blocksOf, sectionOf } from './links'

function pickedFromCompletion(source: string, label: string): string | null {
  const block = blocksOf(source).find((one) => one.text === label)
  if (!block) throw new Error(`no block ${label}`)
  const named = namedBlock(source, block.line, () => 'pick01')
  if (!named) return null
  return sectionOf(named.source, { heading: null, block: named.id })
}
describe('a block inside a list item after a blank, picked in the [[Note#^ completion', () => {
  test('a code block in a numbered step embeds the code, not the steps above', () => {
    const steps = '1. Install\n2. Run:\n\n   ```sh\n   make\n   ```\n3. Done\n'
    const shown = pickedFromCompletion(steps, '```sh') ?? ''
    expect(shown).toContain('make')
    expect(shown).not.toContain('Install')
  })
  test('a table in a bullet item embeds the table, not the item', () => {
    const list = '- Prices:\n\n  | x |\n  |---|\n  | 1 |\n- Later\n'
    const shown = pickedFromCompletion(list, '| x |') ?? ''
    expect(shown).toContain('| 1 |')
    expect(shown).not.toContain('Prices')
  })
})
