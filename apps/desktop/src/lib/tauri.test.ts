/** The one judgement in tauri.ts that is not a platform branch: which addresses
 *  the app hands to the system.
 *
 *  A link in a note is words from the note, and a note can arrive from a shared
 *  space, a room or somebody's export. On the desktop and the phone the opener
 *  plugin's scope is the wall; in a browser there is no such wall, so the same
 *  four schemes are named here. See test/permissions.test.ts for the other half. */

import { describe, expect, test } from 'vitest'
import { isOpenable } from './tauri'

describe('an address the app hands to the system', () => {
  test('is one of the four the opener grants', () => {
    expect(isOpenable('https://nibeditor.com')).toBe(true)
    expect(isOpenable('http://nibeditor.com')).toBe(true)
    expect(isOpenable('HTTPS://nibeditor.com')).toBe(true)
    expect(isOpenable('mailto:me@example.com')).toBe(true)
    expect(isOpenable('tel:+41000000000')).toBe(true)
    expect(isOpenable('//nibeditor.com/a.png')).toBe(true)
  })

  test('is never one that would open something on this machine', () => {
    expect(isOpenable('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isOpenable('smb://server/share')).toBe(false)
    expect(isOpenable('ms-msdt:/id')).toBe(false)
    expect(isOpenable('\\\\server\\share')).toBe(false)
  })

  test('and never one that would run in the page', () => {
    expect(isOpenable('javascript:alert(1)')).toBe(false)
    expect(isOpenable('JavaScript:alert(1)')).toBe(false)
    expect(isOpenable('vbscript:msgbox')).toBe(false)
    expect(isOpenable('data:text/html,<script>alert(1)</script>')).toBe(false)
  })
})
