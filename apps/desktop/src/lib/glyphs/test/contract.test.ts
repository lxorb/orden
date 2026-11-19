import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import { Icon, iconLibrary } from '../src/api'

describe('the glyphs', () => {
  test('draw an emoji as its own text', () => {
    expect(iconLibrary.drawing({ kind: 'emoji', text: '🚀' })).toEqual({
      kind: 'emoji',
      text: '🚀',
    })
    expect(render(Icon, { props: { icon: { kind: 'emoji', text: '🚀' } } }).body).toContain('🚀')
  })
  test('fall back to the stroked shape they are handed when nothing is chosen', () => {
    const body = render(Icon, {
      props: { icon: null, fallback: [['path', { d: 'M4 20l6-6' }]] },
    }).body
    expect(body).toContain('M4 20l6-6')
  })
})
