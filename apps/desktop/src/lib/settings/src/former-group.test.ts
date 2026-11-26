import { describe, expect, test } from 'vitest'
import { formerGroups, middleCut } from './former-group'

const LONG = 'C:\\Users\\Ada Lovelace\\AppData\\Local\\Packages\\so.example.Former\\LocalCache\\Roaming'
describe('a long path in a row', () => {
  test('is cut in the middle, so where it starts and what it ends in both stay', () => {
    const cut = middleCut(LONG)
    expect(Array.from(cut).length).toBe(44)
    expect(cut.startsWith('C:\\Users\\Ada')).toBe(true)
    expect(cut.endsWith('\\LocalCache\\Roaming')).toBe(true)
    expect(cut).toContain('…')
  })
  test('is left whole when it fits, and never splits a character in two', () => {
    expect(middleCut('/home/ada/.config/old')).toBe('/home/ada/.config/old')
    expect(middleCut('𝒜'.repeat(60), 10, 4)).toBe(`${'𝒜'.repeat(5)}…${'𝒜'.repeat(4)}`)
  })
})
const SAID = { title: 'Old folders', caption: 'Still there.' }
describe('the group for what an old folder still holds', () => {
  test('is absent when nothing was left, or before the app has said', () => {
    expect(formerGroups([], SAID)).toEqual([])
    expect(formerGroups([LONG], null)).toEqual([])
  })
  test('is titled and captioned as it was told, with a row for each folder', () => {
    const [group] = formerGroups(['/old/a', '/old/b'], SAID)
    expect(group?.title).toBe('Old folders')
    expect(group?.caption?.text).toBe('Still there.')
    expect(group?.fields.map((one) => one.label)).toEqual(['/old/a', '/old/b'])
  })
  test('names each folder cut short, with the whole path in its hint and on its Show', () => {
    const [group] = formerGroups([LONG], SAID)
    const row = group?.fields[0]
    expect(row?.label).toBe(middleCut(LONG))
    expect(row?.label).not.toBe(LONG)
    expect(row?.hint).toBe(LONG)
    expect(row?.kind === 'value' ? row.does : '').toBe(`Show ${LONG}`)
  })
})
