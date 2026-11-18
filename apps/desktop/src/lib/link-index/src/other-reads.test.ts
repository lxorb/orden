import { expect, test, vi } from 'vitest'

const scans: ((names: string[]) => void)[] = []

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: (command: string) =>
    command === 'scan_links'
      ? new Promise((done) =>
          scans.push((names) =>
            done({
              notes: names.map((name) => ({
                path: `${name}.md`,
                name,
                headings: [],
                blocks: [],
                links: [],
                tags: [],
                icon: null,
                iconColor: null,
                aliases: [],
                url: null,
                favicon: null,
                address: null,
              })),
              files: names.map((name) => `${name}.md`),
            }),
          ),
        )
      : Promise.reject(new Error(`no ${command} here`)),
}))

const { spaceLinks } = await import('./api')

test('a read of another space that was dropped mid read leaves the newer read to answer', async () => {
  const links = spaceLinks()
  links.spaceOf = (path) => (path.startsWith('/other/') ? '/other' : null)
  const from = '/other/Start.md'
  const link = { kind: 'wikilink' as const, target: 'Fresh' }

  const first = links.targetWhenRead(from, link)
  void links.follow({ op: 'removed', kind: 'file', path: '/other/Gone.md', root: '/other' })
  const second = links.targetWhenRead(from, link)
  expect(scans).toHaveLength(2)

  scans[0]?.(['Start'])
  await first
  const third = links.targetWhenRead(from, link)
  scans[1]?.(['Start', 'Fresh'])

  expect(await second).toMatch(/Fresh\.md$/)
  expect(await third).toMatch(/Fresh\.md$/)
})
