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
  test('draw a kept picture from the value alone, with no set to load', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const icon = { kind: 'picture', src: png } as const
    expect(iconLibrary.drawing(icon)).toEqual({ kind: 'picture', src: png })
    expect(iconLibrary.setFor(icon)).toBeNull()
    expect(render(Icon, { props: { icon } }).body).toContain(`src="${png}"`)
  })
  test('draw a one-colour mask in the colour of the text, with no set to load (#2485)', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const icon = { kind: 'mask', src: png } as const
    expect(iconLibrary.drawing(icon)).toEqual({ kind: 'mask', src: png })
    expect(iconLibrary.setFor(icon)).toBeNull()
    const body = render(Icon, { props: { icon } }).body
    expect(body).toContain(`mask-image: url(${png})`)
    expect(body).toContain('background-color: currentColor')
  })
  test('fall back to the stroked shape they are handed when nothing is chosen', () => {
    const body = render(Icon, {
      props: { icon: null, fallback: [['path', { d: 'M4 20l6-6' }]] },
    }).body
    expect(body).toContain('M4 20l6-6')
  })
})
