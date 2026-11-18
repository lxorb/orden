import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'

describe('a definition line under a block in the reading view', () => {
  test('keeps a list whose first item holds a definition a list', () => {
    const html = renderMarkdown('- Apple\n  : a red fruit\n- Banana\n  : a yellow fruit\n')
    expect(html).toContain('<ul>')
    expect(html).not.toContain('<dt>- Apple</dt>')
  })

  test('keeps a numbered step with a note under it a numbered list', () => {
    const html = renderMarkdown('1. Preheat the oven\n   : to 200 degrees\n2. Bake\n')
    expect(html).toContain('<ol>')
    expect(html).not.toContain('1. Preheat')
  })

  test('keeps a heading over a definition line a heading', () => {
    const html = renderMarkdown('## Glossary\n: words used in this note\n')
    expect(html).toContain('<h2')
    expect(html).not.toContain('## Glossary')
  })
})
