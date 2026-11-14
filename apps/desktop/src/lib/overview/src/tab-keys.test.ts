import { expect, test } from 'vitest'
import { lastingKeys } from './tab-keys'

const tab = (id: string, kind: string, path: string | null, shown = '') => ({
  id,
  kind,
  path,
  shown,
})

test('a tab is named by what it shows, so the next run, with new ids, finds it again', () => {
  const first = lastingKeys([tab('1', 'note', '/a.md'), tab('2', 'terminal', null, 'zsh')])
  const next = lastingKeys([tab('9', 'note', '/a.md'), tab('8', 'terminal', null, 'zsh')])
  expect(next.get('9')).toBe(first.get('1'))
  expect(next.get('8')).toBe(first.get('2'))
})

test('two tabs on one file are told apart by which comes first', () => {
  const keys = lastingKeys([tab('1', 'note', '/a.md'), tab('2', 'note', '/a.md')])
  expect(keys.get('1')).not.toBe(keys.get('2'))
  expect(new Set(keys.values()).size).toBe(2)
})
