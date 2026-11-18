export const DOLLAR = 36
export const BACKTICK = 96
export const TILDE = 126
export const EQUALS = 61
export const PERCENT = 37
export const BRACKET_OPEN = 91
export const BRACKET_CLOSE = 93
export const CARET = 94
export const BACKSLASH = 92
export const BANG = 33
export const HASH = 35
export const NEWLINE = 10

export const isDigit = (code: number): boolean => code >= 48 && code <= 57

export const isSpace = (code: number): boolean =>
  code === 32 || code === 9 || code === NEWLINE || code === -1
