import { describe, expect, test } from 'vitest'
import { fenceFrom, prepareFences } from '../src/api'

const none = { parsers: new Map(), diagrams: new Map() }

describe('a code fence before the note is drawn', () => {
  test('is a diagram the drawer drew, in a figure of its language', async () => {
    const asked: string[] = []
    const fence = await prepareFences(
      '```mermaid\ngraph TD\n```\n',
      'dark',
      { highlight: false },
      (code, language, scheme) => {
        asked.push(`${language} ${scheme}`)
        return Promise.resolve(`<svg>${code.trim()}</svg>`)
      },
    )
    expect(asked).toEqual(['mermaid dark'])
    expect(fence('graph TD', 'mermaid') ?? fence('graph TD\n', 'mermaid')).toBe(
      '<figure class="diagram" data-language="mermaid"><svg>graph TD</svg></figure>\n',
    )
  })

  test('is a diagram left to the renderer when the drawer fails', async () => {
    const fence = await prepareFences('```mermaid\nx\n```\n', 'light', { highlight: false }, () =>
      Promise.reject(new Error('no')),
    )
    expect(fence('x', 'mermaid')).toBeNull()
  })

  test('is shown as its own code when it is a base and bases are on, and left alone when not', () => {
    expect(fenceFrom({ ...none, base: true })('<a>', 'base')).toContain('data-base-code="&lt;a&gt;"')
    expect(fenceFrom(none)('<a>', 'base')).toBeNull()
  })

  test('is left to the renderer in a language there is no parser for', () => {
    expect(fenceFrom(none)('x', 'nothing-known')).toBeNull()
  })
})
