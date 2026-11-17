import { afterEach, beforeEach, expect, test } from 'vitest'
import { closeOnBack } from '../../src/lib/ui-kit/src/backstack.svelte'
import { viewport } from '../../src/lib/ui-kit/src/viewport.svelte'

const settled = async () => {
  for (let turn = 0; turn < 12; turn++) await new Promise((resolve) => setTimeout(resolve, 5))
}

const layer = (shut: string[], name: string) => {
  const done = closeOnBack(true, () => shut.push(name))
  if (!done) throw new Error('no layer')
  return done
}

const ours = () => (history.state as { ordenLayer?: number } | null)?.ordenLayer

beforeEach(async () => {
  viewport.device = 'phone'
  await settled()
})

afterEach(() => {
  viewport.device = 'desktop'
})

test('layers that close and open in the same moment leave the history where the app began', async () => {
  const shut: string[] = []
  const base = history.state as unknown

  const left = layer(shut, 'left')
  const right = layer(shut, 'right')
  await settled()

  left()
  right()
  const settings = layer(shut, 'settings')
  const store = layer(shut, 'store')
  await settled()

  store()
  settings()
  await settled()

  expect(ours()).toBeUndefined()
  expect(history.state).toEqual(base)
  expect(shut).toEqual([])
})

test('after that, Back closes only the layer on top, and the next Back the one under it', async () => {
  const shut: string[] = []
  const left = layer(shut, 'left')
  const right = layer(shut, 'right')
  await settled()
  left()
  right()
  layer(shut, 'settings')
  layer(shut, 'store')
  await settled()

  history.back()
  await settled()
  expect(shut).toEqual(['store'])

  history.back()
  await settled()
  expect(shut).toEqual(['store', 'settings'])
  expect(ours()).toBeUndefined()
})

test('a layer closed under another keeps one entry for the one still up', async () => {
  const shut: string[] = []
  const under = layer(shut, 'under')
  layer(shut, 'over')
  await settled()

  under()
  await settled()

  history.back()
  await settled()
  expect(shut).toEqual(['over'])
  expect(ours()).toBeUndefined()
})
