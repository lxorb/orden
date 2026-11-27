import { pushQuietOf } from '@orden/chats/push'
import { describe, expect, test } from 'vitest'
import { tellQuiet } from './quiet'

const QUIET = { hours: { days: [1, 2, 3, 4, 5], from: 540, to: 1080 }, dndUntil: 5000, previews: false, sound: true }
describe('telling the phone when to stay quiet', () => {
  test('hands it the hours, do not disturb, previews and sound as the contract reads them', async () => {
    const told: [string, string][] = []
    const done = await tellQuiet(QUIET, {
      word: () => Promise.resolve('word'),
      tell: (said, json) => told.push([said, json]),
    })
    expect(done).toBe(true)
    expect(told.map(([said, json]) => [said, pushQuietOf(JSON.parse(json))])).toEqual([['word', QUIET]])
  })
  test('tells nothing before the phone has said its word', async () => {
    const told: string[] = []
    expect(await tellQuiet(QUIET, { word: () => Promise.resolve(''), tell: (said) => told.push(said) })).toBe(false)
    expect(told).toEqual([])
  })
  test('is nothing where there is no phone, and a phone that throws is not an error', async () => {
    expect(await tellQuiet(QUIET, { word: () => Promise.resolve('word'), tell: undefined })).toBe(false)
    expect(await tellQuiet(QUIET)).toBe(false)
    const throws = () => {
      throw new Error('gone')
    }
    expect(await tellQuiet(QUIET, { word: () => Promise.resolve('word'), tell: throws })).toBe(false)
  })
})
