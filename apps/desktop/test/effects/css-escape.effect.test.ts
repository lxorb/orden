import { expect, test } from 'vitest'

test('every effect test has CSS.escape, as a browser does, so a selector built from an id never throws', () => {
  expect(CSS.escape('tab-1')).toBe('tab-1')
  expect(CSS.escape('1a')).toBe('\\31 a')
  expect(CSS.escape('-1')).toBe('-\\31 ')
  expect(CSS.escape('-')).toBe('\\-')
  expect(CSS.escape('a b"c]')).toBe('a\\ b\\"c\\]')
  expect(CSS.escape('naïve_x')).toBe('naïve_x')
  expect(document.querySelector(`[data-x="${CSS.escape('a"b')}"]`)).toBeNull()
})
