import { expect, test } from 'vitest'
import { failedSeeds } from './roads'
import { simulate } from './run'

test('1000 seeds of the reference account and devices hold every check', async () => {
  expect(await failedSeeds(1, 1000, (seed) => simulate({ seed }))).toEqual([])
}, 600_000)
