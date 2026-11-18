import { expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'

const BODIES: Record<string, string> = {
  '/space/Start.md': 'See [[Plan]] and [[Later]].',
  '/space/Plan.md': '# Plan',
  '/other/Later.md': '# Later',
}

vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'scan_links') {
      return {
        notes: ['Start.md', 'Plan.md'].map((one) => scanNote(one, BODIES[`/space/${one}`] ?? '')),
        files: [],
      }
    }
    if (command === 'read_note') {
      const body = BODIES[path]
      if (body === undefined) throw new Error(`no such note: ${path}`)
      return body
    }
    return undefined
  },
}))

const { spaceLinks } = await import('./api')
const { startup } = await import('../../launch/src/api')

void startup.shown()

const wiki = (target: string) => ({ kind: 'wikilink' as const, target })

test('a note moved out of the space leaves its links, and one moved in from another space joins them', async () => {
  const links = spaceLinks()
  await links.build('/space')
  expect(links.targetOf('/space/Start.md', wiki('Plan'))).toBe('Plan.md')
  expect(links.targetOf('/space/Start.md', wiki('Later'))).toBeNull()

  await links.follow({
    op: 'moved',
    kind: 'file',
    from: '/space/Plan.md',
    to: '/other/Plan.md',
    root: '/space',
    into: '/other',
  })
  expect(links.targetOf('/space/Start.md', wiki('Plan'))).toBeNull()

  BODIES['/space/Later.md'] = BODIES['/other/Later.md'] ?? ''
  await links.follow({
    op: 'moved',
    kind: 'file',
    from: '/other/Later.md',
    to: '/space/Later.md',
    root: '/other',
    into: '/space',
  })
  expect(links.targetOf('/space/Start.md', wiki('Later'))).toBe('Later.md')
})
