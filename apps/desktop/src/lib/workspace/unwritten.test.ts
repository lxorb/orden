/** A tab that comes back with words its file never got, against what the file says now:
 *  a window killed before the pause, and a tab closed a moment after its last keystroke.
 *  H3-WINDOWS-3 and H3-DESKTOP-2. */

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

describe('a tab with unwritten words', () => {
  test('where the file has not moved: as it was, and owed', async () => {
    const { desk } = disk(BASE)
    expect(await cameBack(draft(), desk)).toEqual({
      path: '/s/Both.md',
      text: OLD,
      dirty: true,
      onDisk: BASE,
      home: null,
    })
  })

  test('where the file says them already: clean, nothing to write', async () => {
    const { desk } = disk(OLD)
    expect(await cameBack(draft(), desk)).toMatchObject({ text: OLD, dirty: false, onDisk: OLD })
  })

  test('the same, with the file in CRLF', async () => {
    const { desk } = disk(OLD.replace(/\n/g, '\r\n'))
    expect(await cameBack(draft(), desk)).toMatchObject({ text: OLD, dirty: false, onDisk: OLD })
  })

  test('where the file has moved on: both stay, and are owed against what it says', async () => {
    const newer = `${BASE}NEWER-IN-B\n`
    const { desk } = disk(newer)
    const back = await cameBack(draft(), desk)
    expect(back.text).toContain('OLD-FROM-A')
    expect(back.text).toContain('NEWER-IN-B')
    expect(back).toMatchObject({ path: '/s/Both.md', dirty: true, onDisk: newer })
  })

  test('where the file went on with those words in it: the file, clean', async () => {
    const newer = `${OLD}A PARAGRAPH FROM THE OTHER DEVICE\n`
    const { desk } = disk(newer)
    expect(await cameBack(draft(), desk)).toMatchObject({
      text: newer,
      dirty: false,
      onDisk: newer,
    })
  })

  test('where the words were taken out of the file later: not put back', async () => {
    const newer = `# Both\n\nsomething else\n`
    const { desk } = disk(newer)
    const back = await cameBack(draft({ doc: BASE, base: BASE }), desk)
    expect(back).toMatchObject({ text: newer, dirty: false })
  })

  test('where the file has gone: a draft of its own, in the space it was in', async () => {
    const { desk } = disk(null)
    expect(await cameBack(draft(), desk)).toEqual({
      path: null,
      text: OLD,
      dirty: true,
      onDisk: null,
      home: 'space-1',
    })
  })

  test('where the file will not read: the words stay on it, owed, and nothing is merged', async () => {
    const { desk } = disk(null, true)
    expect(await cameBack(draft(), desk)).toMatchObject({
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
    const { desk } = disk(null)
    expect(await cameBack(draft(none), desk)).toMatchObject({
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
    const { desk } = disk('# T\nbody\n\n## To do\nx\n')
    const back = await cameBack(draft({ base: '# T\nbody\n', doc: '# To\nbody\n' }), desk)
    expect(back.dirty).toBe(true)
    expect(back.text).toContain('# To\nbody')
    expect(back.text).toContain('## To do')
  })

  test('words with long enough a run beside them are', async () => {
    const left = 'a line long enough to say where this was typed\n'
    const { desk } = disk(`${left}typed\nand the rest\nNEWER\n`)
    const back = await cameBack(draft({ base: `${left}and the rest\n`, doc: `${left}typed\nand the rest\n` }), desk)
    expect(back).toMatchObject({ dirty: false })
  })

  test('at the very end, with what followed since', async () => {
    const { desk } = disk('# n\nmine\nmore\n')
    const back = await cameBack(draft({ base: '# n\n', doc: '# n\nmine\n' }), desk)
    expect(back).toMatchObject({ text: '# n\nmine\nmore\n', dirty: false })
  })
})

describe('a share not answering at the launch', () => {
  test('is no file gone: the words wait on the file, owed', async () => {
    const { desk } = disk(null)
    const back = await cameBack(draft(), { ...desk, reachable: () => Promise.resolve(false) })
    expect(back).toMatchObject({ path: '/s/Both.md', dirty: true, onDisk: BASE })
  })
})

describe('a file back at the version the words were typed on', () => {
  /** The words landed, the session did not hear, and somebody took them out again: from
   *  here that is a write that never landed, so the file is kept before it is replaced. */
  test('is kept as a version before they go down', async () => {
    const { desk, keepVersion } = disk(BASE)
    await cameBack(draft(), desk)
    expect(keepVersion).toHaveBeenCalledWith('/s/Both.md', BASE)
  })
})
