import { describe, expect, test } from 'vitest'
import { settingMerged } from './settings'

describe('a setting changed on two devices', () => {
  test('keeps this device’s order of a list nobody else touched', () => {
    expect(settingMerged('toolbar', ['a', 'b', 'c'], ['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
  })
  test('takes the other device’s value where this one changed nothing', () => {
    expect(settingMerged('toolbar', ['a', 'b'], ['a', 'b'], ['b'])).toEqual(['b'])
  })
  test('reads no hidden kinds as an empty list', () => {
    expect(settingMerged('hiddenKinds', null, ['canvas'], ['pdf'])).toEqual(['pdf', 'canvas'])
    expect(settingMerged('hiddenKinds', ['canvas'], null, ['canvas', 'pdf'])).toEqual(['pdf'])
  })
  test('keeps the default toolbar this device went back to', () => {
    expect(settingMerged('toolbar', ['a'], null, ['a', 'b'])).toBeNull()
  })
  test('counts a list never heard as empty, so nothing the other device added is lost', () => {
    expect(settingMerged('archivedSpaces', undefined, ['c'], ['b'])).toEqual(['b', 'c'])
    expect(settingMerged('glassesWords', undefined, { a: 'x' }, { b: 'y' })).toEqual({ a: 'x', b: 'y' })
  })
  test('lets this device’s plain value stand', () => {
    expect(settingMerged('preset', 'orden', 'vscode', 'vim')).toBe('vscode')
  })
})
