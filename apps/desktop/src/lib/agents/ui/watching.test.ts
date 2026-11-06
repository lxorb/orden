import { expect, test } from 'vitest'
import type { Picture } from '../verbs'
import { Watching } from './watching.svelte'

const shot = (png: string): Picture => ({ png, width: 1, height: 1 })

test('looks asked while one runs are one more look, not a pile', async () => {
  let asked = 0
  const answers: ((picture: Picture) => void)[] = []
  const watching = new Watching(() => {
    asked += 1
    return new Promise((done) => answers.push(done))
  })

  const first = watching.look()
  void watching.look()
  void watching.look()
  expect(asked).toBe(1)

  answers[0]?.(shot('a'))
  await Promise.resolve()
  await Promise.resolve()
  expect(asked).toBe(2)
  answers[1]?.(shot('b'))
  await first
  expect(asked).toBe(2)
  expect(watching.picture?.png).toBe('b')
})

test('a failed look keeps the last picture and says it is stale', async () => {
  let fail = false
  const watching = new Watching(() =>
    fail ? Promise.reject(new Error('gone')) : Promise.resolve(shot('a')),
  )
  await watching.look()
  fail = true
  await watching.look()
  expect(watching.picture?.png).toBe('a')
  expect(watching.failed).toBe(true)
})
