import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

vi.mock('../../ai-chat/src/store/chat.svelte', () => ({
  chat: { unfolded: false, root: '/n/Work', thread: null },
}))
const PartRow = (await import('./PartRow.svelte')).default
function row(verb: string, args: unknown): { verb: string; object: string; server: string | null } {
  const target = document.createElement('div')
  document.body.append(target)
  const part = { kind: 'tool', id: 't1', verb, args, state: 'done' }
  const shown = mount(PartRow, { target, props: { part: part as never } })
  flushSync()
  const said = (name: string) => target.querySelector(`.${name}`)?.textContent ?? null
  const out = { verb: said('verb') ?? '', object: said('object') ?? '', server: said('server') }
  void unmount(shown)
  target.remove()
  return out
}
test('a tool from another server is named by its own name beside its server, never as Orden’s (#2227)', () => {
  expect(row('mcp__notes__read_note', { path: 'Birds/Herons.md' })).toEqual({
    verb: 'read_note',
    object: 'Herons',
    server: 'notes',
  })
  expect(row('mcp__github__search_issues', { query: 'kestrel' })).toEqual({
    verb: 'search_issues',
    object: '“kestrel”',
    server: 'github',
  })
  expect(row('mcp__orden__read_note', { path: 'Birds/Herons.md' })).toEqual({
    verb: 'Read',
    object: 'Herons',
    server: null,
  })
  expect(row('read_note', { path: 'Birds/Herons.md' })).toEqual({ verb: 'Read', object: 'Herons', server: null })
})
