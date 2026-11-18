import { expect, test } from 'vitest'
import { putsAway } from './sheet-pull'

test.each([
  [30, 600, 0.1, false],
  [160, 600, 0.1, true],
  [130, 900, 0.1, true],
  [24, 600, 0.9, true],
  [6, 600, 2, false],
  [-80, 600, -1, false],
])(
  'a sheet let go %ipx down of %ipx at %f goes away past a quarter, a thumb or on a flick, not a twitch or a push up: %s',
  (pulled, height, speed, away) => {
    expect(putsAway(pulled, height, speed)).toBe(away)
  },
)
