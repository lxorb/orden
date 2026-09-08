import { describe, expect, test } from 'vitest'
import { planSpaces } from './space-plan'

const local = (name: string) => ({ name, root: `/spaces/${name}` })
const remote = (name: string, id = `id-${name}`) => ({ id, name })
const mirror = (name: string, id = `id-${name}`) => ({ root: `/spaces/${name}`, spaceId: id })

const plan = (input: Partial<Parameters<typeof planSpaces>[0]>) =>
  planSpaces({ local: [], remote: [], mirrors: [], deleted: [], ...input })

describe('a machine that is already in step', () => {
  test('has nothing to do', () => {
    const result = plan({
      local: [local('Work')],
      remote: [remote('Work')],
      mirrors: [mirror('Work')],
    })

    expect(result).toEqual({ pair: [], upload: [], adopt: [], drop: [], detach: [], remove: [] })
  })
})

describe('a space this machine has and the account does not', () => {
  test('goes up', () => {
    const result = plan({ local: [local('Work')] })
    expect(result.upload.map((one) => one.name)).toEqual(['Work'])
  })
})

describe('a space the account has and this machine does not', () => {
  test('comes down - which is what used to be missing entirely', () => {
    const result = plan({ remote: [remote('Ideas')] })

    expect(result.adopt.map((one) => one.name)).toEqual(['Ideas'])
    expect(result.upload).toEqual([])
  })

  test('is what makes two machines agree', () => {
    // One has Work, the other has Ideas, the account has both.
    const here = plan({
      local: [local('Work')],
      remote: [remote('Work'), remote('Ideas')],
      mirrors: [mirror('Work')],
    })

    expect(here.adopt.map((one) => one.name)).toEqual(['Ideas'])
  })
})

describe('a folder and a space with the same name', () => {
  test('are the same space, not two', () => {
    const result = plan({ local: [local('Work')], remote: [remote('Work')] })

    expect(result.pair).toEqual([{ root: '/spaces/Work', spaceId: 'id-Work' }])
    expect(result.upload).toEqual([])
    expect(result.adopt).toEqual([])
  })

  test('are never uploaded and adopted at once', () => {
    const result = plan({
      local: [local('Work'), local('Ideas')],
      remote: [remote('Ideas'), remote('Journal')],
    })

    expect(result.upload.map((one) => one.name)).toEqual(['Work'])
    expect(result.pair.map((one) => one.spaceId)).toEqual(['id-Ideas'])
    expect(result.adopt.map((one) => one.name)).toEqual(['Journal'])
  })
})

describe('a folder that is gone from this machine', () => {
  test('stops being mirrored', () => {
    const result = plan({ remote: [remote('Work')], mirrors: [mirror('Work')] })
    expect(result.drop).toEqual(['/spaces/Work'])
  })
})

describe('a space deleted from the account elsewhere', () => {
  test('lets go of the mirror', () => {
    const result = plan({ local: [local('Work')], mirrors: [mirror('Work')] })
    expect(result.detach).toEqual(['/spaces/Work'])
  })

  test('is uploaded again on the pass after, rather than stranded here', () => {
    // A folder kept out of the account forever is the one thing worse than an
    // extra upload: the two machines never agree again.
    const result = plan({ local: [local('Work')] })

    expect(result.upload.map((one) => one.name)).toEqual(['Work'])
  })

  test('is not removed on a gap alone', () => {
    // Missing is indistinguishable from never uploaded, and guessing wrong
    // here costs someone their writing.
    const result = plan({ local: [local('Work')], mirrors: [mirror('Work')] })
    expect(result.remove).toEqual([])
  })
})

describe('a space the account says was deleted', () => {
  test('is removed here too, so the deletion wins', () => {
    const result = plan({
      local: [local('Work')],
      mirrors: [mirror('Work')],
      deleted: ['id-Work'],
    })

    expect(result.remove).toEqual(['/spaces/Work'])
    expect(result.upload).toEqual([])
  })

  test('is not uploaded again by a machine that was offline', () => {
    const result = plan({
      local: [local('Work')],
      mirrors: [mirror('Work')],
      deleted: ['id-Work'],
    })

    expect(result.upload).toEqual([])
    expect(result.detach).toEqual([])
  })

  test('frees its name for a new space of the same name, in one pass', () => {
    // Deleted "Work" (id-old), then a new "Work" made elsewhere (id-new). The
    // stale folder goes and the new space is taken up together, so the space
    // does not vanish and reappear a pass later.
    const result = plan({
      local: [local('Work')],
      remote: [remote('Work', 'id-new')],
      mirrors: [mirror('Work', 'id-old')],
      deleted: ['id-old'],
    })

    expect(result.remove).toEqual(['/spaces/Work'])
    expect(result.adopt.map((one) => one.id)).toEqual(['id-new'])
  })

  test('does not upload the folder it is about to remove', () => {
    const result = plan({
      local: [local('Work')],
      remote: [remote('Work', 'id-new')],
      mirrors: [mirror('Work', 'id-old')],
      deleted: ['id-old'],
    })

    expect(result.upload).toEqual([])
    expect(result.pair).toEqual([])
  })

  test('leaves other spaces untouched while one is removed', () => {
    const result = plan({
      local: [local('Work'), local('Ideas')],
      remote: [remote('Ideas')],
      mirrors: [mirror('Work', 'id-old'), mirror('Ideas')],
      deleted: ['id-old'],
    })

    expect(result.remove).toEqual(['/spaces/Work'])
    expect(result.drop).toEqual([])
    expect(result.detach).toEqual([])
  })

  test('leaves a folder that was never mirrored alone', () => {
    // Same name, but this machine never had it paired with that space, so
    // there is nothing saying this folder is the one that was deleted.
    const result = plan({ local: [local('Work')], deleted: ['id-Work'] })

    expect(result.remove).toEqual([])
    expect(result.upload.map((one) => one.name)).toEqual(['Work'])
  })
})

describe('two folders with the same name', () => {
  test('do not both claim the one space', () => {
    const result = plan({
      local: [
        { name: 'Work', root: '/a/Work' },
        { name: 'Work', root: '/b/Work' },
      ],
      remote: [remote('Work')],
    })

    expect(result.pair).toHaveLength(1)
    expect(result.upload).toEqual([])
  })
})

describe('a space somebody shared', () => {
  const shared = (name: string, id = `id-${name}`) => ({
    root: `/spaces/${name}`,
    spaceId: id,
    shared: true,
  })

  test('goes when it stops being listed, because the sharing was taken back', () => {
    // No marker: the space still exists, it is simply not this account's to
    // reach any more. Uploading the folder again would put a copy of somebody
    // else's space into this account.
    const result = plan({ local: [local('Work')], mirrors: [shared('Work')] })

    expect(result.remove).toEqual(['/spaces/Work'])
    expect(result.detach).toEqual([])
    expect(result.upload).toEqual([])
  })

  test('is still told apart from one of the account’s own that is merely missing', () => {
    const result = plan({ local: [local('Work')], mirrors: [mirror('Work')] })

    expect(result.detach).toEqual(['/spaces/Work'])
    expect(result.remove).toEqual([])
  })

  test('gets a folder of its own when the name is already answering for another', () => {
    // Somebody shares their Work with an account that already has one. The
    // account's own folder keeps its space, and the shared one is adopted.
    const result = plan({
      local: [local('Work')],
      remote: [remote('Work', 'id-mine'), remote('Work', 'id-theirs')],
      mirrors: [mirror('Work', 'id-mine')],
    })

    expect(result.adopt.map((one) => one.id)).toEqual(['id-theirs'])
    expect(result.upload).toEqual([])
    expect(result.detach).toEqual([])
  })

  test('is adopted only once, however many passes go by', () => {
    const first = plan({
      local: [local('Work')],
      remote: [remote('Work', 'id-mine'), remote('Work', 'id-theirs')],
      mirrors: [mirror('Work', 'id-mine')],
    })
    expect(first.adopt).toHaveLength(1)

    // The next pass, with the folder the adoption made.
    const again = plan({
      local: [local('Work'), { name: 'Work 2', root: '/spaces/Work 2' }],
      remote: [remote('Work', 'id-mine'), remote('Work', 'id-theirs')],
      mirrors: [mirror('Work', 'id-mine'), { root: '/spaces/Work 2', spaceId: 'id-theirs' }],
    })

    expect(again).toEqual({
      pair: [],
      upload: [],
      adopt: [],
      drop: [],
      detach: [],
      remove: [],
    })
  })
})
