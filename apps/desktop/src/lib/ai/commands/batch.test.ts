// /batch over a folder takes the notes in that folder and nothing else: a folder named
// like it somewhere else, or one whose name only ends the same, is not it.

import { expect, test, vi } from 'vitest'
import { Matcher } from '../../search/match'
import type { Query } from '../../search/query'
import { newThread } from '../chat/threads'
import type { Thread } from '../chat/types'
import type { Host } from './host'
import type { Ended } from './types'

const ROOT = '/vault'
const NOTES: Record<string, string> = {
  'Inbox/a.md': 'a',
  'Inbox/Deep/e.md': 'e',
  'inbox/f.md': 'f',
  'Old Inbox/b.md': 'b',
  'Projects/Inbox/c.md': 'c',
  'MyInbox/d.md': 'd',
  'Elsewhere/g.md': '#todo',
}

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'space', root: ROOT }],
    activeSpace: null,
    leftOutOf: () => [],
  },
}))

// The space's own search, answered by the matcher both sides share.
vi.mock('../../search/space', () => ({
  searchSpace: (
    _root: string,
    query: Query,
    _terms: string[],
    most: number,
    onFound: (found: { hits: unknown[]; loose: unknown[] }) => void,
  ) => {
    const matcher = new Matcher(query)
    const hits = Object.entries(NOTES).flatMap(([relative, body]) =>
      matcher.hits(
        { path: `${ROOT}/${relative}`, relative, name: relative.replace(/^.*\//, ''), body },
        most,
      ),
    )
    onFound({ hits, loose: [] })
    return Promise.resolve()
  },
}))

const { batch } = await import('./helpers')

async function batched(instruction: string): Promise<string[]> {
  const asked: string[] = []
  const ended: Ended = { stop: 'end', turn: null, usage: null }
  const host = {
    turn: (_thread: Thread, text: string) => {
      asked.push(/\[\[(.*)\]\]/.exec(text)?.[1] ?? '')
      return Promise.resolve(ended)
    },
    adopt: () => {},
    touched: () => {},
    line: () => {},
  } as unknown as Host
  await batch(host, newThread('space', 'p', 'm'), instruction)
  return asked.sort()
}

test('/batch over Inbox/ takes only the notes in the folder Inbox', async () => {
  expect(await batched('tag every note in Inbox/ with done')).toEqual([
    'Inbox/Deep/e',
    'Inbox/a',
    'inbox/f',
  ])
})

test('/batch over a folder and a tag takes both, and only those', async () => {
  expect(await batched('tag every note in Projects/Inbox/ and #todo')).toEqual([
    'Elsewhere/g',
    'Projects/Inbox/c',
  ])
})
