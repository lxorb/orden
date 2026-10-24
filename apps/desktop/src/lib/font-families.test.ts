import { describe, expect, test } from 'vitest'
import { isInstalled, offered } from './font-families'

/** The families a font picker offers, and in what order (#772). */
const FAMILIES = [
  { name: 'DejaVu Sans', mono: false },
  { name: 'DejaVu Sans Mono', mono: true },
  { name: 'Inter', mono: false },
  { name: 'JetBrains Mono', mono: true },
]

describe('the families offered', () => {
  test('are every one installed, in the order they came, for a face for prose', () => {
    expect(offered(FAMILIES, '', false).map((one) => one.name)).toEqual([
      'DejaVu Sans',
      'DejaVu Sans Mono',
      'Inter',
      'JetBrains Mono',
    ])
  })

  test('put the monospaced first for a face for code, and still offer the rest', () => {
    expect(offered(FAMILIES, '', true).map((one) => one.name)).toEqual([
      'DejaVu Sans Mono',
      'JetBrains Mono',
      'DejaVu Sans',
      'Inter',
    ])
  })

  test('narrow to the ones whose name has what was typed, whatever its case', () => {
    expect(offered(FAMILIES, 'dejavu', true).map((one) => one.name)).toEqual([
      'DejaVu Sans Mono',
      'DejaVu Sans',
    ])
    expect(offered(FAMILIES, '  ', false)).toHaveLength(4)
  })
})

describe('a name this machine is asked to draw', () => {
  /** Where nothing can be measured there is nothing to say, rather than a false "not
   *  installed" under every name. */
  test('is taken as installed where there is no canvas to measure it on', () => {
    expect(isInstalled('Anything At All')).toBe(true)
    expect(isInstalled('')).toBe(true)
  })
})
