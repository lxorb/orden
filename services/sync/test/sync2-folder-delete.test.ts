import { expect, test } from 'vitest'
import { type Device, engineSpace } from './engine-kit'
import { signIn } from './harness'

const { at, device, passed } = engineSpace()

const onDisk = (one: Device) =>
  Object.fromEntries(
    [...one.disk.files.entries()].map(([path, words]) => [path.slice(one.root.length + 1), words]),
  )

test('a folder deleted while a new note in it is listed and not pulled comes back whole', async () => {
  const a = await device('a', { 'f/one.md': 'one\n', 'f/two.md': 'two\n', 'keep.md': 'keep\n' })
  await passed(a)
  const b = await device(
    'b',
    {},
    { token: await signIn(at.env, 'pictures@example.com'), role: 'owner' },
  )
  await passed(a, b)

  await a.disk.write(`${a.root}/f/new.md`, 'new from A\n')
  await a.engine.foreign(`${a.root}/f/new.md`)
  await a.engine.created(`${a.root}/f/new.md`, false, 'new from A\n')
  await passed(a)

  const { readFeed } = (await import(
    /* @vite-ignore */ new URL(
      '../../../apps/desktop/src/lib/sync-client/src/pass.ts',
      import.meta.url,
    ).href
  )) as { readFeed: (core: unknown, space: unknown, go: () => boolean) => Promise<unknown> }
  await readFeed(b.engine.core, b.engine.core.spaces.get(at.space), () => true)
  expect(onDisk(b)['f/new.md']).toBeUndefined()

  for (const path of [...b.disk.files.keys()]) {
    if (path.includes('/f/')) await b.disk.remove(path)
  }
  await b.engine.removed(`${b.root}/f`)
  await passed(a, b, a, b, a, b)

  const whole = {
    'f/one.md': 'one\n',
    'f/two.md': 'two\n',
    'f/new.md': 'new from A\n',
    'keep.md': 'keep\n',
  }
  expect(onDisk(b)).toEqual(whole)
  expect(onDisk(a)).toEqual(whole)
  const { results } = await at.env.DB.prepare(
    'select count(*) as gone from notes where space_id = ? and deleted = 1',
  )
    .bind(at.space)
    .all<{ gone: number }>()
  expect(results[0]?.gone).toBe(0)
})
