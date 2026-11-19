import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { buildDecorations } from './live-preview/decorate'
import { trustedMarkup } from './markup'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function stateOf(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), trustedMarkup(false)],
    }),
  )
}
function shownLines(doc: string): string[] {
  const state = stateOf(doc)
  const gone = new Set<number>()
  buildDecorations(state).decorations.between(0, doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: unknown }
    if (!value.point || spec.class || spec.widget) return
    for (let at = from; at < to; at++) gone.add(at)
  })
  const shown: string[] = []
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    let text = ''
    for (let at = line.from; at < line.to; at++) if (!gone.has(at)) text += doc[at] ?? ''
    shown.push(text)
  }
  return shown
}
const leadOf = (text: string) => /^ */.exec(text)?.[0].length ?? 0
describe('indentation inside a quote or callout in Live Preview', () => {
  test('code in a callout keeps its own indentation', () => {
    const doc = '> [!example] Python\n> ```py\n> def total(items):\n>     return sum(items)\n> ```\n\nafter'
    const shown = shownLines(doc)
    expect(shown[2]).toBe('def total(items):')
    expect(shown[3]).toBe('    return sum(items)')
  })
  test('code in a list item in a callout keeps its own indentation', () => {
    const doc = '> [!note]\n> - step\n>   ```py\n>   if ready:\n>       go()\n>   ```\n\nafter'
    const shown = shownLines(doc)
    expect(leadOf(shown[4] ?? '') - leadOf(shown[3] ?? '')).toBe(4)
  })
  test('a nested item in a callout is drawn deeper than its parent, as outside a quote', () => {
    const plain = shownLines('- parent\n  - child\n\nafter')
    expect(leadOf(plain[1] ?? '')).toBeGreaterThan(leadOf(plain[0] ?? ''))
    const quoted = shownLines('> [!note]\n> - parent\n>   - child\n\nafter')
    expect(leadOf(quoted[2] ?? '')).toBeGreaterThan(leadOf(quoted[1] ?? ''))
  })
})
