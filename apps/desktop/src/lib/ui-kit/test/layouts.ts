import { PHYSICAL, readLayout } from '../src/keys'

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const codeOf = (letter: string) => `Key${letter.toUpperCase()}`
function lettered(rows: string[], extra: Record<string, string> = {}): Record<string, string> {
  const laid: Record<string, string> = { ...PHYSICAL }
  rows.forEach((row, at) => {
    Array.from(row).forEach((one, index) => {
      const under = ROWS[at]?.[index]
      if (under) laid[codeOf(under)] = one
    })
  })
  return { ...laid, ...extra }
}
export const LAYOUTS: Record<string, Record<string, string>> = {
  qwerty: lettered(ROWS),
  colemak: lettered(['qwfpgjluy', 'arstdhnei', 'zxcvbkm'], { Semicolon: 'o', KeyP: ';' }),
  dvorak: lettered(["',.pyfgcrl", 'aoeuidhtn', ';qjkxbm'], {
    Semicolon: 's',
    Quote: '-',
    Minus: '[',
    Equal: ']',
    BracketLeft: '/',
    BracketRight: '=',
    Comma: 'w',
    Period: 'v',
    Slash: 'z',
  }),
  azerty: lettered(['azertyuiop', 'qsdfghjkl', 'wxcvbn'], {
    Semicolon: 'm',
    KeyM: ',',
    Comma: ';',
    Period: ':',
    Slash: '!',
    Digit1: '&',
    Digit2: 'é',
    Digit3: '"',
    Digit4: "'",
    Digit5: '(',
    Digit6: '-',
    Digit7: 'è',
    Digit8: '_',
    Digit9: 'ç',
    Digit0: 'à',
  }),
  qwertz: lettered(['qwertzuiop', 'asdfghjkl', 'yxcvbnm'], {
    Minus: 'ß',
    Slash: '-',
    BracketLeft: 'ü',
    Semicolon: 'ö',
    Quote: 'ä',
  }),
  russian: lettered(['йцукенгшщз', 'фывапролд', 'ячсмить'], {
    BracketLeft: 'х',
    BracketRight: 'ъ',
    Semicolon: 'ж',
    Quote: 'э',
    Comma: 'б',
    Period: 'ю',
    Slash: '.',
    Backquote: 'ё',
  }),
}
export const LETTERS = Array.from('abcdefghijklmnopqrstuvwxyz')
export const LETTER_CODES = LETTERS.map((letter) => `Key${letter.toUpperCase()}`)
const latin = (one: string) => /^[a-z]$/.test(one)
const ascii = (one: string) => /^[!-~]$/.test(one)
export function letterUnder(layout: Record<string, string>, code: string): string | undefined {
  const typed = layout[code] ?? ''
  if (latin(typed)) return typed
  const under = PHYSICAL[code] ?? ''
  return !ascii(typed) && latin(under) ? under : undefined
}
export function writtenUnder(layout: Record<string, string>, code: string): string | undefined {
  const typed = layout[code] ?? ''
  return ascii(typed) ? typed : PHYSICAL[code]
}
export function pressOn(
  layout: Record<string, string>,
  code: string,
  held: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {},
) {
  const typed = layout[code] ?? ''
  return {
    key: held.shift ? typed.toUpperCase() : typed,
    code,
    ctrlKey: !!held.ctrl,
    metaKey: !!held.meta,
    altKey: !!held.alt,
    shiftKey: !!held.shift,
  }
}
export function readsLayout(layout: Record<string, string> | null, stub: (name: string, value: unknown) => void) {
  stub('navigator', {
    userAgent: '',
    keyboard: { getLayoutMap: () => Promise.resolve(new Map(Object.entries(layout ?? {}))) },
  })
  return readLayout()
}
