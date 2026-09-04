import { describe, expect, test } from 'vitest'
import { planSpaces } from './space-plan'

const local = (name: string) => ({ name, root: `/spaces/${name}` })
const remote = (name: string, id = `id-${name}`) => ({ id, name })
const mirror = (name: string, id = `id-${name}`) => ({ root: `/spaces/${name}`, spaceId: id })

const plan = (input: Partial<Parameters<typeof planSpaces>[0]>) =>
  planSpaces({ local: [], remote: [], mirrors: [], ...input })

describe('a machine that is already in step', () => {
  test('has nothing to do', () => {
    const result = plan({
      local: [local('Work')],
      remote: [remote('Work')],
      mirrors: [mirror('Work')],
    })

    expect(result).toEqual({ pair: [], upload: [], adopt: [], drop: [], detach: [] })
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

  test('never removes the folder, whatever the account says', () => {
    const result = plan({ local: [local('Work')], mirrors: [mirror('Work')] })

    expect(result).not.toHaveProperty('remove')
    expect(result.upload.concat(result.adopt as never)).toBeDefined()
  })
})

describe('two folders with the same name', () => {
  test('do not both claim the one space', () => {
    const result = plan({
      local: [{ name: 'Work', root: '/a/Work' }, { name: 'Work', root: '/b/Work' }],
      remote: [remote('Work')],
    })

    expect(result.pair).toHaveLength(1)
    expect(result.upload).toEqual([])
  })
})
