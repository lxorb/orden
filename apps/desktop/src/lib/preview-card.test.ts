import { describe, expect, test } from 'vitest'
import { caretFor } from './preview-card'

describe('where a glance opens', () => {
  const matter = '---\ntitle: Everything\ntags:\n  - one\n---\n\n# Everything\n\nWords.\n'

  test('below the front matter, for a link that names the whole note', () => {
    const at = caretFor({ path: 'Everything.md', text: matter, at: 0 })

    expect(at).toBe(matter.indexOf('\n\n# Everything') + 1)
    expect(matter.slice(0, at)).toContain('tags:')
    expect(matter.slice(at)).not.toContain('tags:')
  })

  test('at character nought where the note has no front matter', () => {
    expect(caretFor({ path: 'Plain.md', text: '# Plain\n\nWords.\n', at: 0 })).toBe(0)
  })

  test('where the link pointed, when that is past the front matter', () => {
    const heading = matter.indexOf('# Everything')
    expect(caretFor({ path: 'Everything.md', text: matter, at: heading })).toBe(heading)
  })

  test('and a note that only looks like it has some opens at the top', () => {
    const rule = '---\n\nA line under nothing.\n'
    expect(caretFor({ path: 'Rule.md', text: rule, at: 0 })).toBe(0)
  })

  test('inside the note, whatever the link asked for', () => {
    expect(caretFor({ path: 'Plain.md', text: 'short', at: 900 })).toBe(5)
    expect(caretFor({ path: 'Plain.md', text: 'short', at: -4 })).toBe(0)
  })
})
