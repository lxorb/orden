import { describe, expect, test } from 'vitest'
import { type Moment, startsFresh } from './fresh-start'

/** When a launch starts fresh, on the welcome note, which is Obsidian's rule: no
 *  vault, a fresh start. One moment that is one, and every reason that is not, one
 *  at a time. */

const FRESH: Moment = {
  native: true,
  plugin: false,
  restored: true,
  spaces: 0,
  restoring: false,
  signedIn: false,
  invited: false,
  tabs: 0,
}

describe('a fresh start', () => {
  test('is a desktop or phone app with no space', () => {
    expect(startsFresh(FRESH)).toBe(true)
  })

  test.each<[string, Partial<Moment>]>([
    ['the browser build, which seeds its welcome note itself', { native: false }],
    ['the plugin, which never makes anything new', { plugin: true }],
    ['before the spaces folder has been read', { restored: false }],
    ['once there is a space', { spaces: 1 }],
    ['while the account is still being looked for', { restoring: true }],
    ['for somebody signed in, whose spaces are on their way', { signedIn: true }],
    ['while a link somebody followed is being walked through', { invited: true }],
    ['over a file handed over at launch', { tabs: 1 }],
  ])('is not %s', (_, change) => {
    expect(startsFresh({ ...FRESH, ...change })).toBe(false)
  })

  test('comes back when the last space goes', () => {
    expect(startsFresh({ ...FRESH, spaces: 1 })).toBe(false)
    expect(startsFresh({ ...FRESH, spaces: 0 })).toBe(true)
  })
})
