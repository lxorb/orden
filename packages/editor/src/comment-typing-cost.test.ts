import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { ordenMarkdownExtensions } from './markdown/extensions'

function noteWith(top: string, middle: string, count = 20_000): string {
  const lines: string[] = [top, 'Top words', '']
  for (let at = 0; at < count; at++) {
    if (at === count / 2) lines.push(middle)
    else lines.push(at % 5 === 0 ? '' : `line ${at} of the long note`)
  }
  lines.push('', 'Last words')
  return lines.join('\n')
}
function created(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
  })
}
function warmed(...docs: string[]): string[] {
  for (const doc of docs) typedAtEndMs(doc)
  return docs
}
function typedAtEndMs(doc: string): number {
  let state = created(doc)
  ensureSyntaxTree(state, doc.length, 60_000)
  const started = performance.now()
  for (const one of 'typed at the end....') {
    state = state.update({ changes: { from: state.doc.length, insert: one } }).state
    ensureSyntaxTree(state, state.doc.length, 60_000)
  }
  return performance.now() - started
}
const COMMENT = '\n%%\nhidden\n%%\n'
const PLAIN = '\nplain\nwords\n'
const FRONT = '---\ntitle: Long note\n---'
describe('typing at the end of a 20,000 line note holding one %% comment block above', () => {
  test('costs about what it costs in the same note without it', { timeout: 60_000 }, () => {
    const [plain = '', commented = ''] = warmed(noteWith('Intro', PLAIN), noteWith('Intro', COMMENT))
    expect(typedAtEndMs(commented)).toBeLessThan(typedAtEndMs(plain) * 4 + 100)
  })
  test('and the same under front matter', { timeout: 60_000 }, () => {
    const [plain = '', commented = ''] = warmed(noteWith(FRONT, PLAIN), noteWith(FRONT, COMMENT))
    expect(typedAtEndMs(commented)).toBeLessThan(typedAtEndMs(plain) * 4 + 100)
  })
  test('and the same when the %% line is a line of code', { timeout: 60_000 }, () => {
    const [plain = '', commented = ''] = warmed(
      noteWith(FRONT, '\n```\nplain code\n```\n'),
      noteWith(FRONT, '\n```\n%% cell\n```\n'),
    )
    expect(typedAtEndMs(commented)).toBeLessThan(typedAtEndMs(plain) * 4 + 100)
  })
})
