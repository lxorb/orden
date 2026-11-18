import { afterEach, describe, expect, test } from 'vitest'
import { prepare, recordEquationLabel, resetEquationLabels } from './render'

afterEach(resetEquationLabels)

describe('equation labels', () => {
  test.each([
    ['E = mc^2 \\label{eq:mass}', 'E = mc^2 '],
    ['\\eqref{missing}', '\\eqref{missing}'],
    ['\\int_0^\\infty e^{-x^2}\\,dx', '\\int_0^\\infty e^{-x^2}\\,dx'],
  ])('%j', (input, wanted) => expect(prepare(input)).toEqual(wanted))

  test('a reference resolves to the number it was given', () => {
    recordEquationLabel('E = mc^2 \\label{eq:mass}', 3)
    expect(prepare('see \\eqref{eq:mass}')).toBe('see (3)')
  })

  test('the short form works too', () => {
    recordEquationLabel('x \\label{one}', 1)
    expect(prepare('\\ref{one}')).toBe('(1)')
  })

  test('equations without a label record nothing', () => {
    recordEquationLabel('E = mc^2', 1)
    expect(prepare('\\eqref{eq:mass}')).toBe('\\eqref{eq:mass}')
  })

  test('resetting forgets earlier documents', () => {
    recordEquationLabel('x \\label{a}', 1)
    resetEquationLabels()
    expect(prepare('\\eqref{a}')).toBe('\\eqref{a}')
  })
})
