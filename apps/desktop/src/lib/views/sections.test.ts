import { describe, expect, test } from 'vitest'
import {
  aboutOf,
  cutSection,
  duplicatedSection,
  isTitle,
  movedSection,
  renamedSection,
  retitled,
  withBlock,
  withSection,
} from './sections'

const NOTE = `# Home

- [ ] Loose

## Kitchen
- [ ] Fix the tap ^tap

## Garden
- [ ] Mow
`

describe('a project’s sections', () => {
  test('are added at the end, or after one, at their neighbours’ level', () => {
    expect(withSection(NOTE, 'Attic', null, 'Home')).toBe(`${NOTE}\n## Attic\n`)
    expect(withSection(NOTE, 'Hall', 'Kitchen', 'Home')).toBe(
      '# Home\n\n- [ ] Loose\n\n## Kitchen\n- [ ] Fix the tap ^tap\n\n## Hall\n\n## Garden\n- [ ] Mow\n',
    )
    expect(withSection('', 'First', null, 'Home')).toBe('## First\n')
    expect(withSection('# Home\n', 'First', null, 'Home')).toBe('# Home\n\n## First\n')
    expect(withSection(NOTE, '  ', null, 'Home')).toBeNull()
    expect(withSection(NOTE, 'Hall', 'Nowhere', 'Home')).toBeNull()
  })

  test('are named again, keeping what they hold', () => {
    expect(renamedSection(NOTE, 'Garden', 'Yard')).toBe(NOTE.replace('## Garden', '## Yard'))
    expect(renamedSection(NOTE, 'Garden', 'Garden')).toBeNull()
    expect(renamedSection(NOTE, 'Nowhere', 'Yard')).toBeNull()
  })

  test('are taken out whole, to be deleted or carried to another note', () => {
    const cut = cutSection(NOTE, 'Kitchen')
    expect(cut?.block).toEqual(['## Kitchen', '- [ ] Fix the tap ^tap', ''])
    expect(cut?.rest).toBe('# Home\n\n- [ ] Loose\n\n## Garden\n- [ ] Mow\n')
    expect(withBlock('- [ ] A\n', cut?.block ?? [])).toBe(
      '- [ ] A\n\n## Kitchen\n- [ ] Fix the tap ^tap\n',
    )
  })

  test('are duplicated under themselves, the copy without block names', () => {
    expect(duplicatedSection(NOTE, 'Kitchen', 'Kitchen copy')).toBe(
      '# Home\n\n- [ ] Loose\n\n## Kitchen\n- [ ] Fix the tap ^tap\n\n## Kitchen copy\n- [ ] Fix the tap\n\n## Garden\n- [ ] Mow\n',
    )
  })

  test('move past their sibling, and no further', () => {
    expect(movedSection(NOTE, 'Garden', true)).toBe(
      '# Home\n\n- [ ] Loose\n\n## Garden\n- [ ] Mow\n\n## Kitchen\n- [ ] Fix the tap ^tap\n',
    )
    expect(movedSection(NOTE, 'Kitchen', false)).toBe(movedSection(NOTE, 'Garden', true))
    expect(movedSection(NOTE, 'Kitchen', true)).toBeNull()
    expect(movedSection(NOTE, 'Garden', false)).toBeNull()
  })

  test('are not headings in a fence, and a title is none', () => {
    const fenced = '```\n## Not one\n```\n## Real\n'
    expect(renamedSection(fenced, 'Not one', 'X')).toBeNull()
    expect(renamedSection(fenced, 'Real', 'X')).toBe('```\n## Not one\n```\n## X\n')
    expect(isTitle('Home', 'home')).toBe(true)
    expect(isTitle('Kitchen', 'Home')).toBe(false)
  })
})

describe('what a project says about itself', () => {
  test('is the words at the top of its note, past its properties and its title', () => {
    expect(
      aboutOf('---\ncolor: red\n---\n# Home\nThe flat, and the garden.\n\n- [ ] A\n', 'Home'),
    ).toBe('The flat, and the garden.')
    expect(aboutOf('Two lines\nof it.\n## Kitchen\n', 'Home')).toBe('Two lines of it.')
    expect(aboutOf('- [ ] A\n', 'Home')).toBeNull()
    expect(aboutOf('# Home\n## Kitchen\nNot this.\n', 'Home')).toBeNull()
  })
})

describe('a project named again', () => {
  test('takes its title with it, and nothing else', () => {
    expect(retitled('# Home\n- [ ] A\n', 'Home', 'House')).toBe('# House\n- [ ] A\n')
    expect(retitled('---\na: 1\n---\n\n# Home\n', 'Home', 'House')).toBe(
      '---\na: 1\n---\n\n# House\n',
    )
    expect(retitled('## Home\n', 'Home', 'House')).toBeNull()
    expect(retitled('# Other\n', 'Home', 'House')).toBeNull()
  })
})
