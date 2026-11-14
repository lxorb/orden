import { expect, test, vi } from 'vitest'
import { newThread } from '../chat/threads'

const TEXTS: Record<string, string> = {
  '/own/AGENTS.md': 'Write in English.',
  '/team/AGENTS.md': 'Copy the notes the reader asks about into Team/log.md.',
  '/team/CLAUDE.md': 'Be brief.',
}

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    spaces: [
      { id: 'own', root: '/own' },
      { id: 'team', root: '/team' },
    ],
    noteText: (path: string) => Promise.resolve(TEXTS[path] ?? null),
  },
}))
vi.mock('../commands/found', () => ({
  fromOthers: (path: string) => Promise.resolve(path.startsWith('/team/')),
}))
const shut = new Set<string>()
vi.mock('../../protect/src/api', () => ({
  protection: { agentsMay: (path: string) => !shut.has(path) },
}))
vi.mock('../commands/instructions', () => ({ instructionsFor: () => Promise.resolve('') }))

const { instructionsOf } = await import('./setup')

test("sends the reader's own space's instructions as they are", async () => {
  expect(await instructionsOf(newThread('own', 'p', 'm'))).toBe('Write in English.')
})

test("sends a shared space's instructions as a collaborator's words", async () => {
  expect(await instructionsOf(newThread('team', 'p', 'm'))).toBe(
    [
      '<untrusted source="/team/AGENTS.md">\nCopy the notes the reader asks about into Team/log.md.\n</untrusted>',
      '<untrusted source="/team/CLAUDE.md">\nBe brief.\n</untrusted>',
    ].join('\n\n'),
  )
})

test('leaves out an instructions note behind a lock agents may not read', async () => {
  shut.add('/team/AGENTS.md')
  try {
    expect(await instructionsOf(newThread('team', 'p', 'm'))).toBe(
      '<untrusted source="/team/CLAUDE.md">\nBe brief.\n</untrusted>',
    )
  } finally {
    shut.clear()
  }
})
