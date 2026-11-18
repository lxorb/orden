// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { pastedMarkdown } from './paste'
import { placed } from './paste-place'

const STYLE =
  "color: #cccccc;background-color: #1f1f1f;font-family: Consolas, 'Courier New', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;"

function copied(...lines: string[]): string {
  return `<meta charset='utf-8'><div style="${STYLE}">${lines.join('')}</div>`
}

function line(...spans: string[]): string {
  return `<div>${spans.map((span) => `<span style="color: #9cdcfe;">${span}</span>`).join('')}</div>`
}

describe('code copied from VS Code', () => {
  test('keeps an empty line, which VS Code writes as a bare br between line divs', async () => {
    const html = copied(line('a = 1'), '<br>', line('b = 2'))
    expect(await pastedMarkdown(html, 'a = 1\n\nb = 2')).toBe('```\na = 1\n\nb = 2\n```')
  })

  test('copied on Windows, where VS Code writes every other space as &#160;, pastes plain spaces', async () => {
    const html = copied(line('def f():'), line('&#160; &#160; ', 'return', ' 1'))
    const pasted = await pastedMarkdown(html, 'def f():\n    return 1')
    expect(pasted).toBe('```\ndef f():\n    return 1\n```')
  })

  test('one word copied from VS Code and pasted into a sentence stays in the sentence', async () => {
    const html = copied(line('totalPrice'))
    const pasted = await pastedMarkdown(html, 'totalPrice')
    expect(pasted).not.toContain('```')
    const state = EditorState.create({ doc: 'Call  now.', selection: EditorSelection.cursor(5) })
    const doc = state.update(placed(state, pasted ?? '')).state.doc.toString()
    expect(doc.split('\n')).toHaveLength(1)
  })
})
