import { describe, expect, test } from 'vitest'
import { readGraph } from '../src/sync-server-engine/src/spaces/graph'
import { spaceField } from './space-field'

const { put, listed, column, kept, owned } = spaceField('graph')

const DRAWN = {
  filter: 'tag:work -path:archive',
  orphans: false,
  attachments: true,
  groups: [{ query: 'tag:work', colour: 2 }],
  spread: 1.5,
  gather: false,
  distance: 60,
  push: 220,
  arrows: true,
  sized: false,
  lines: 3,
  fade: 0.5,
  depth: 2,
}

kept({}, DRAWN, { filter: '' })
owned({}, DRAWN)

describe('what a space may say about its graph', () => {
  test('is an object, and never a list or a word', async () => {
    expect((await put([])).status).toBe(400)
    expect((await put('all of it')).status).toBe(400)
  })

  test('and a field this build has never heard of is dropped, not refused', async () => {
    const set = await put({ arrows: true, curvature: 3 })

    expect(set.status).toBe(200)
    expect(set.json.graph).toEqual({ arrows: true })
  })

  test('and a switch that is not one is dropped rather than guessed at', async () => {
    const set = await put({ arrows: 'yes', sized: true })

    expect(set.json.graph).toEqual({ sized: true })
  })

  test('and a spread or a depth outside what the app offers is held to it', async () => {
    const set = await put({ spread: 400, gather: true, depth: 9 })

    expect(set.json.graph).toEqual({ spread: 4, gather: true, depth: 5 })
    expect((await put({ depth: 4 })).json.graph).toEqual({ depth: 4 })
    expect((await put({ depth: 0 })).json.graph).toEqual({ depth: 1 })
  })

  test('and a line width outside the three steps is held to them', async () => {
    expect((await put({ lines: 9 })).json.graph).toEqual({ lines: 3 })
    expect((await put({ lines: 0 })).json.graph).toEqual({ lines: 1 })
    expect((await put({ lines: 'thick' })).json.graph).toEqual({})
  })

  test('and a link distance or a push outside the dials is held to them', async () => {
    expect((await put({ distance: 900 })).json.graph).toEqual({ distance: 96 })
    expect((await put({ distance: 1 })).json.graph).toEqual({ distance: 12 })
    expect((await put({ push: 9000 })).json.graph).toEqual({ push: 400 })
    expect((await put({ push: 1 })).json.graph).toEqual({ push: 40 })
  })

  test('and a text fade outside what the dial offers is held to it', async () => {
    expect((await put({ fade: 40 })).json.graph).toEqual({ fade: 4 })
    expect((await put({ fade: 0 })).json.graph).toEqual({ fade: 0.25 })
    expect((await put({ fade: 1.5 })).json.graph).toEqual({ fade: 1.5 })
  })

  test('and a filter longer than a query is refused, so nothing else is lost', async () => {
    expect((await put({ filter: 'a'.repeat(201) })).status).toBe(400)
    expect((await put({ filter: 'a'.repeat(200) })).status).toBe(200)
  })

  test('and the row a card has just added, with nothing typed in it yet, is kept', async () => {
    const set = await put({ groups: [{ query: '', colour: 4 }] })

    expect(set.json.graph).toEqual({ groups: [{ query: '', colour: 4 }] })
  })

  test('and more colour groups than the theme has colours is refused', async () => {
    const many = Array.from({ length: 7 }, (_one, index) => ({
      query: `tag:t${index}`,
      colour: 1,
    }))

    expect((await put({ groups: many })).status).toBe(400)
  })

  test('and a group with no colour, or one the theme has not, is put right', async () => {
    const set = await put({
      groups: [{ query: 'tag:work', colour: 99 }, { query: 'path:x' }, { colour: 3 }],
    })

    expect(set.json.graph).toEqual({
      groups: [
        { query: 'tag:work', colour: 6 },
        { query: 'path:x', colour: 1 },
      ],
    })
  })
})

describe('reading the column back', () => {
  test('keeps what reads as a setting and leaves the rest', async () => {
    column('{"arrows":true,"filter":"plan","somethingElse":{"deep":1}}')

    expect(await listed()).toEqual({ filter: 'plan', arrows: true })
  })

  test('and answers with nothing at all for a column that is not an object', () => {
    expect(readGraph('not json')).toEqual({})
    expect(readGraph('[1,2]')).toEqual({})
    expect(readGraph('null')).toEqual({})
  })
})
