import { EditorState, EditorView } from '@orden/editor'
import { expect, test, vi } from 'vitest'

vi.mock('../../surfaces.svelte', () => ({ rewriteSheet: { ask: () => Promise.resolve() } }))

const { rewriting } = await import('./rewriting.svelte')

function viewOf(doc: string, from: number, to: number): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: from, head: to } }),
  })
}

test('a rewrite taken after the note changed above its words replaces those words', () => {
  const view = viewOf('Notes. A heron stands still. The end.', 7, 28)
  rewriting.show(view)
  rewriting.after = 'A heron waits.'
  view.dispatch({ changes: { from: 0, insert: 'Synced from the phone. ' } })

  rewriting.accept()

  expect(view.state.doc.toString()).toBe('Synced from the phone. Notes. A heron waits. The end.')
  view.destroy()
})

test('a rewrite whose words are gone from the note replaces nothing, and says so', () => {
  const view = viewOf('Notes. A heron stands still. The end.', 7, 28)
  rewriting.show(view)
  rewriting.after = 'A heron waits.'
  view.dispatch({ changes: { from: 7, to: 28, insert: 'An egret flew off.' } })

  rewriting.accept()

  expect(view.state.doc.toString()).toBe('Notes. An egret flew off. The end.')
  expect(rewriting.open).toBe(true)
  expect(rewriting.trouble).toContain('no longer in the note')
  rewriting.close()
  view.destroy()
})
