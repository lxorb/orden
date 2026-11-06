import { describe, expect, test } from 'vitest'
import { declaredIn, settingOf } from './declared'

function page(properties: Record<string, string>): (name: string) => string {
  return (name) => properties[name] ?? ''
}

describe('what a theme may declare', () => {
  test('a number in a range, with the unit it is measured in', () => {
    const found = settingOf('blur', 'range "Blur" 0 40 18 px')

    expect(found).toMatchObject({ id: 'blur', label: 'Blur', kind: 'range', min: 0, max: 40 })
    expect(found?.initial).toBe(18)
    expect(found?.paint(24, 'dark')).toEqual({ '--nib-blur': '24px' })
  })

  test('and a bare number, which is what a multiplier is', () => {
    const found = settingOf('weight', 'range "Weight" 0 2 1')

    expect(found?.paint(1.5, 'dark')).toEqual({ '--nib-weight': '1.5' })
  })

  test('a switch, which writes a one or a nought so CSS can do sums with it', () => {
    const found = settingOf('paper', 'switch "Frosted paper" off')

    expect(found).toMatchObject({ kind: 'switch', initial: false })
    expect(found?.paint(true, 'dark')).toEqual({ '--nib-paper': '1' })
    expect(found?.paint(false, 'dark')).toEqual({ '--nib-paper': '0' })
  })

  test('a choice, whose first option is where it starts', () => {
    const found = settingOf('depth', 'choice "Depth" "Flat" 0 "Deep" 1')

    expect(found).toMatchObject({ kind: 'choice', initial: '0' })
    expect(found?.kind === 'choice' && found.options).toEqual([
      { value: '0', label: 'Flat' },
      { value: '1', label: 'Deep' },
    ])
  })

  test('and a colour, which is a choice whose options are painted rather than read', () => {
    const found = settingOf('glow', 'colour "Glow" "Violet" #7c6bf5 "Blue" #3584e4')

    expect(found).toMatchObject({ kind: 'colour', initial: '#7c6bf5' })
    expect(found?.kind === 'colour' && found.options[0]).toEqual({
      value: '#7c6bf5',
      name: 'Violet',
      dark: '#7c6bf5',
      light: '#7c6bf5',
    })
  })

  test('a label with a space in it, which is the only reason a label is quoted', () => {
    expect(settingOf('tint', 'range "How much tint" 0 100 50 %')?.label).toBe('How much tint')
    expect(settingOf('tint', 'range Tint 0 100 50 %')?.label).toBe('Tint')
  })

  test('and either quote, because CSS has both and a formatter picks one', () => {
    expect(settingOf('tint', "range 'How much tint' 0 100 50 %")?.label).toBe('How much tint')
    expect(settingOf('depth', `choice 'Depth' 'Flat' 0 "Deep" 1`)).toMatchObject({
      kind: 'choice',
      initial: '0',
    })
  })

  test('and a dial nobody has to choose the step of', () => {
    expect(settingOf('a', 'range "A" 0 40 1 px')).toMatchObject({ step: 1 })
    expect(settingOf('b', 'range "B" 0 100 1 %')).toMatchObject({ step: 1 })
    expect(settingOf('c', 'range "C" 0 1 0.5')).toMatchObject({ step: 0.01 })
  })
})

describe('what a theme may not', () => {
  test.each([
    ['a kind nobody has heard of', 'colour-wheel "Glow" #fff'],
    ['nothing at all', ''],
    ['a range with no numbers in it', 'range "Blur" low high middle'],
    ['a range that starts outside itself', 'range "Blur" 0 40 90 px'],
    ['a range that runs backwards', 'range "Blur" 40 0 20 px'],
    ['a unit that is not a length', 'range "Blur" 0 40 18 furlongs'],
    ['a range with something extra on the end', 'range "Blur" 0 40 18 px please'],
    ['a switch that is neither on nor off', 'switch "Paper" maybe'],
    ['a choice with an option missing its value', 'choice "Depth" "Flat" 0 "Deep"'],
    ['a choice with no options at all', 'choice "Depth"'],
    ['a colour that is not one', 'colour "Glow" "Violet" rebeccapurple'],
    ['a quote left open', 'range "Blur 0 40 18 px'],
  ])('refuses %s', (_what, spec) => {
    expect(settingOf('thing', spec)).toBeNull()
  })

  test('refuses an id that is not a word', () => {
    expect(settingOf('Blur!', 'range "Blur" 0 40 18 px')).toBeNull()
  })

  test('refuses a label long enough to be a sentence', () => {
    const long = `range "${'a'.repeat(25)}" 0 40 18 px`
    expect(settingOf('blur', long)).toBeNull()
  })

  test('refuses a list longer than a row of controls', () => {
    const many = Array.from({ length: 13 }, (_one, at) => `"O${at}" ${at}`).join(' ')
    expect(settingOf('depth', `choice "Depth" ${many}`)).toBeNull()
  })

  test('and writes one property, named after itself, whatever it was handed', () => {
    const found = settingOf('glow', 'colour "Glow" "Violet" #7c6bf5')
    expect(Object.keys(found?.paint('#7c6bf5', 'dark') ?? {})).toEqual(['--nib-glow'])
  })
})

describe('a stylesheet, read', () => {
  const CSS = `
    :root {
      --nib-setting-tint: range "Tint" 60 100 82 %;
      --nib-setting-blur: range "Blur" 0 40 20 px;
      --colour: #fff;
    }
  `

  test('declares what it names, with the values the page resolved', () => {
    const found = declaredIn(
      CSS,
      page({
        '--nib-setting-tint': ' range "Tint" 60 100 82 % ',
        '--nib-setting-blur': 'range "Blur" 0 40 20 px',
      }),
    )

    expect(found.map((one) => one.id)).toEqual(['tint', 'blur'])
    expect(found[0]?.initial).toBe(82)
  })

  test('takes the value off the page and not out of the file, so a scheme can differ', () => {
    const found = declaredIn(CSS, page({ '--nib-setting-tint': 'range "Tint" 60 100 95 %' }))

    expect(found).toHaveLength(1)
    expect(found[0]?.initial).toBe(95)
  })

  test('drops the one it cannot read and keeps the one it can', () => {
    const found = declaredIn(
      CSS,
      page({
        '--nib-setting-tint': 'range "Tint" 60 100 82 %',
        '--nib-setting-blur': 'wobble "Blur" a lot',
      }),
    )

    expect(found.map((one) => one.id)).toEqual(['tint'])
  })

  test('finds nothing in a theme that declares nothing', () => {
    expect(declaredIn(':root { --bg: #000; }', page({}))).toEqual([])
  })

  test('stops at six, which is a theme and not a control panel', () => {
    const names = Array.from({ length: 9 }, (_one, at) => `d${at}`)
    const css = names.map((id) => `--nib-setting-${id}: x;`).join('\n')
    const answers = Object.fromEntries(
      names.map((id) => [`--nib-setting-${id}`, `range "${id}" 0 10 5`]),
    )

    expect(declaredIn(css, page(answers)).map((one) => one.id)).toEqual(names.slice(0, 6))
  })
})
