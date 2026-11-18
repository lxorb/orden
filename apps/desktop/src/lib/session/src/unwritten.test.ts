import { describe, expect, test, vi } from 'vitest'
import type { Draft } from './session'
import { cameBack } from './unwritten'

const BASE = '# Both\n\nbase line\n'
const OLD = `${BASE}OLD-FROM-A\n`

const draft = (fields: Partial<Draft> & { path?: string } = {}): Draft & { path: string } => ({
  kind: 'note',
  path: '/s/Both.md',
  name: 'Both.md',
  doc: OLD,
  dirty: true,
  cursor: 0,
  scroll: 0,
  base: BASE,
  ...fields,
})

function disk(says: string | null, exists = says !== null) {
  const keepVersion = vi.fn(() => Promise.resolve())
  return {
    keepVersion,
    desk: {
      read: () => Promise.resolve(says),
      exists: () => Promise.resolve(exists),
      keepVersion,
      spaceOf: () => 'space-1',
      reachable: () => Promise.resolve(true),
    },
  }
}

const back = (says: string | null, fields: Parameters<typeof draft>[0] = {}, exists?: boolean) =>
  cameBack(draft(fields), disk(says, exists).desk)

describe('a tab with unwritten words', () => {
  test('where the file has not moved: as it was, and owed', async () => {
    expect(await back(BASE)).toEqual({
      path: '/s/Both.md',
      text: OLD,
      dirty: true,
      onDisk: BASE,
      home: null,
    })
  })

  test('where the file says them already: clean, nothing to write', async () => {
    expect(await back(OLD)).toMatchObject({ text: OLD, dirty: false, onDisk: OLD })
  })

  test('the same, with the file in CRLF', async () => {
    expect(await back(OLD.replace(/\n/g, '\r\n'))).toMatchObject({
      text: OLD,
      dirty: false,
      onDisk: OLD,
    })
  })

  test('where the file has moved on: both stay, and are owed against what it says', async () => {
    const newer = `${BASE}NEWER-IN-B\n`
    const came = await back(newer)
    expect(came.text).toContain('OLD-FROM-A')
    expect(came.text).toContain('NEWER-IN-B')
    expect(came).toMatchObject({ path: '/s/Both.md', dirty: true, onDisk: newer })
  })

  test('where the file went on with those words in it: the file, clean', async () => {
    const newer = `${OLD}A PARAGRAPH FROM THE OTHER DEVICE\n`
    expect(await back(newer)).toMatchObject({
      text: newer,
      dirty: false,
      onDisk: newer,
    })
  })

  test('where the words were taken out of the file later: not put back', async () => {
    const newer = `# Both\n\nsomething else\n`
    const came = await back(newer, { doc: BASE, base: BASE })
    expect(came).toMatchObject({ text: newer, dirty: false })
  })

  test('where the file has gone: a draft of its own, in the space it was in', async () => {
    expect(await back(null)).toEqual({
      path: null,
      text: OLD,
      dirty: true,
      onDisk: null,
      home: 'space-1',
    })
  })

  test('where the file will not read: the words stay on it, owed, and nothing is merged', async () => {
    expect(await back(null, {}, true)).toMatchObject({
      path: '/s/Both.md',
      text: OLD,
      dirty: true,
      onDisk: BASE,
    })
  })

  test('a plane does not merge: the newer file stays, and the old words a draft', async () => {
    const before = '{"nodes":[]}'
    const { desk } = disk('{"nodes":[2]}')
    expect(
      await cameBack(draft({ kind: 'canvas', doc: '{"nodes":[1]}', base: before }), desk),
    ).toEqual({
      path: null,
      text: '{"nodes":[1]}',
      dirty: true,
      onDisk: null,
      home: 'space-1',
    })
  })

  test('a plane whose file has not moved goes down', async () => {
    const before = '{"nodes":[]}'
    const { desk } = disk(before)
    expect(
      await cameBack(draft({ kind: 'canvas', doc: '{"nodes":[1]}', base: before }), desk),
    ).toMatchObject({ path: '/s/Both.md', dirty: true, onDisk: before })
  })
})

describe('with no version to go by: a session of an older build, a note not yet written', () => {
  const none = { base: undefined }

  test('a file there is kept as a version before the words go down', async () => {
    const { desk, keepVersion } = disk(`${BASE}OTHER\n`)
    expect(await cameBack(draft(none), desk)).toMatchObject({
      path: '/s/Both.md',
      text: OLD,
      dirty: true,
      onDisk: null,
    })
    expect(keepVersion).toHaveBeenCalledWith('/s/Both.md', `${BASE}OTHER\n`)
  })

  test('no file: the words make it, as a note never written does', async () => {
    expect(await back(null, none)).toMatchObject({
      path: '/s/Both.md',
      dirty: true,
      onDisk: null,
    })
  })

  test('the file says them: clean', async () => {
    const { desk, keepVersion } = disk(OLD)
    expect(await cameBack(draft(none), desk)).toMatchObject({ dirty: false, onDisk: OLD })
    expect(keepVersion).not.toHaveBeenCalled()
  })
})

describe('over a file that has gone on', () => {
  test('a few characters alike somewhere else are not the words typed', async () => {
    const came = await back('# T\nbody\n\n## To do\nx\n', {
      base: '# T\nbody\n',
      doc: '# To\nbody\n',
    })
    expect(came.dirty).toBe(true)
    expect(came.text).toContain('# To\nbody')
    expect(came.text).toContain('## To do')
  })

  test('words with long enough a run beside them are', async () => {
    const left = 'a line long enough to say where this was typed\n'
    const came = await back(`${left}typed\nand the rest\nNEWER\n`, {
      base: `${left}and the rest\n`,
      doc: `${left}typed\nand the rest\n`,
    })
    expect(came).toMatchObject({ dirty: false })
  })

  test('at the very end, with what followed since', async () => {
    const came = await back('# n\nmine\nmore\n', { base: '# n\n', doc: '# n\nmine\n' })
    expect(came).toMatchObject({ text: '# n\nmine\nmore\n', dirty: false })
  })
})

describe('a share not answering at the launch', () => {
  test('is no file gone: the words wait on the file, owed', async () => {
    const { desk } = disk(null)
    const came = await cameBack(draft(), { ...desk, reachable: () => Promise.resolve(false) })
    expect(came).toMatchObject({ path: '/s/Both.md', dirty: true, onDisk: BASE })
  })
})

describe('a file back at the version the words were typed on', () => {
  test('is kept as a version before they go down', async () => {
    const { desk, keepVersion } = disk(BASE)
    await cameBack(draft(), desk)
    expect(keepVersion).toHaveBeenCalledWith('/s/Both.md', BASE)
  })
})
