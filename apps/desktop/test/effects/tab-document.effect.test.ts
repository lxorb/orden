import { flushSync } from 'svelte'
import { expect, test } from 'vitest'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'
import { root, watch } from './runes.svelte'

function documentAt(path: string): NoteDoc {
  return new NoteDoc(
    { kind: 'note', path, name: path.split('/').at(-1) ?? '', text: '', dirty: false },
    () => undefined,
  )
}

test('a tab pointed at another document is seen by whatever is watching it', () => {
  const tab = new Tab(documentAt('/space/One.md'), 'pane')
  const seen: (string | null)[] = []

  const stop = root(() => {
    watch(() => {
      seen.push(tab.note.path)
    })
  })
  flushSync()

  tab.note = documentAt('/space/Two.md')
  flushSync()
  stop()

  expect(seen).toEqual(['/space/One.md', '/space/Two.md'])
})
