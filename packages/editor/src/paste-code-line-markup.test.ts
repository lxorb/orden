// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { renderMarkdown } from '@orden/markdown'
import { pastedMarkdown } from './paste'

const STYLE =
  "color: #cccccc;background-color: #1f1f1f;font-family: Consolas, 'Courier New', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;"

function copied(code: string): string {
  return `<meta charset='utf-8'><div style="${STYLE}"><div><span style="color: #9cdcfe;">${code}</span></div></div>`
}

describe('one line copied from VS Code', () => {
  test('with underscores and stars shows as the code, not as bold words', async () => {
    const code = 'def __init__(self, **kwargs):'
    const pasted = await pastedMarkdown(copied(code), code)
    const drawn = renderMarkdown(pasted ?? '')
    expect(drawn).not.toContain('<strong>')
    expect(drawn).not.toContain('<em>')
  })

  test('with a generic type keeps the type in sight', async () => {
    const code = 'const names: Array<string> = []'
    const html = copied('const names: Array&lt;string&gt; = []')
    const pasted = await pastedMarkdown(html, code)
    expect(renderMarkdown(pasted ?? '')).toContain('&lt;string&gt;')
  })
})
