import { EditorState, EditorView, SharedDoc } from '@orden/editor'
import { expect, test, vi } from 'vitest'

const completed = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  complete: () => {
    completed.count++
    return Promise.resolve('A heron waits.')
  },
  ai: { providerFor: () => ({ id: 'p', model: 'm' }) },
}))
const diary = vi.hoisted(() => ({ live: null as object | null }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    get tabs() {
      return [{ path: '/notes/Private/Diary.md', note: { live: diary.live } }]
    },
  },
}))
vi.mock('../../protect/src/api', () => ({
  protection: { agentsMay: (path?: string | null) => path !== '/notes/Private/Diary.md' },
}))
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
test('a rewrite in a note shut to agents asks nothing of the model, and says why', () => {
  const view = viewOf('Notes. A heron stands still. The end.', 7, 28)
  const live = new SharedDoc(view.state.doc.toString())
  live.join(view)
  diary.live = live
  completed.count = 0
  rewriting.show(view)
  rewriting.run('shorter')
  expect(completed.count).toBe(0)
  expect(rewriting.running).toBe(false)
  expect(rewriting.trouble).toContain('Let agents read')
  rewriting.close()
  view.destroy()
})
