import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { dropAt, landingMark } from './handle'
import { landing, moveBlock } from './move'
import { blockAt } from './span'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const NOTE = [
  'cleanes konto',
  '',
  'quaestur:',
  '- [ ] clean up the repo',
  '- [ ] payrexx import',
  '- [ ] abacus zahlungsmethode',
  '',
  '',
  '',
  '',
].join('\n')
const stateOf = (doc: string) =>
  parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
function carried(state: EditorState, words: string, pos: number, upper: boolean) {
  const span = blockAt(state, state.doc.toString().indexOf(words))
  if (!span) throw new Error(`no block at ${words}`)
  const at = dropAt(state, pos, () => upper)
  const to = at === null ? null : landing(state, span, at)
  if (to === null) return { mark: null, text: state.doc.toString() }
  const { line, under } = landingMark(state, to)
  const edit = moveBlock(state, span, to)
  return {
    mark: { text: line.text, under },
    text: edit ? state.update({ changes: edit.changes }).state.doc.toString() : state.doc.toString(),
  }
}
const lines = (text: string) => text.split('\n').filter((one) => one.trim())
describe('the line a carried block would land on (#2039)', () => {
  const state = stateOf(NOTE)
  const at = (words: string) => NOTE.indexOf(words)
  test('under the last block, the line sits right under it, not under the empty lines after it', () => {
    const dropped = carried(state, 'payrexx', at('abacus') + 3, false)
    expect(dropped.mark).toEqual({ text: '- [ ] abacus zahlungsmethode', under: true })
    expect(lines(dropped.text).slice(-2)).toEqual(['- [ ] abacus zahlungsmethode', '- [ ] payrexx import'])
  })
  test('the empty area under the note lands after the last block, drawn under it', () => {
    const dropped = carried(state, 'payrexx', NOTE.length, true)
    expect(dropped.mark).toEqual({ text: '- [ ] abacus zahlungsmethode', under: true })
    expect(lines(dropped.text).at(-1)).toBe('- [ ] payrexx import')
  })
  test('in the gap between two blocks, it lands between them, drawn over the lower', () => {
    const dropped = carried(state, 'payrexx', at('quaestur') - 1, true)
    expect(dropped.mark).toEqual({ text: 'quaestur:', under: false })
    expect(lines(dropped.text).slice(0, 3)).toEqual(['cleanes konto', '- [ ] payrexx import', 'quaestur:'])
  })
  test('over the top half of the first block, it lands at the top', () => {
    const dropped = carried(state, 'abacus', 2, true)
    expect(dropped.mark).toEqual({ text: 'cleanes konto', under: false })
    expect(lines(dropped.text)[0]).toBe('- [ ] abacus zahlungsmethode')
  })
  test('over the lower half of a block in the middle, it lands under it, over the next', () => {
    const dropped = carried(state, 'abacus', at('clean up') + 3, false)
    expect(dropped.mark).toEqual({ text: '- [ ] payrexx import', under: false })
    expect(lines(dropped.text).slice(2)).toEqual([
      '- [ ] clean up the repo',
      '- [ ] abacus zahlungsmethode',
      '- [ ] payrexx import',
    ])
  })
})
