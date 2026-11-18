import { expect, test } from 'vitest'
import { keepsSystemMenu } from './system-menu'

test.each([
  ['TEXTAREA', undefined, 'macos', true],
  ['INPUT', 'text', 'macos', true],
  ['INPUT', 'search', 'macos', true],
  ['INPUT', 'password', 'macos', false],
  ['INPUT', 'checkbox', 'macos', false],
  ['DIV', undefined, 'macos', false],
  [null, undefined, 'macos', false],
  ['TEXTAREA', undefined, 'windows', false],
  ['INPUT', 'text', 'linux', false],
] as const)(
  'the system menu is kept on a %s %s on %s only in a Mac text field, for Look Up, spelling and Services: %s',
  (tagName, type, platform, kept) => {
    const target = tagName ? ({ tagName, type } as unknown as EventTarget) : null
    expect(keepsSystemMenu(target, platform)).toBe(kept)
  },
)
