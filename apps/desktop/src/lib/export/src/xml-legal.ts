const ILLEGAL = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu

export function legalXml(text: string): string {
  return text.replace(/[\v\f]/g, ' ').replace(ILLEGAL, '')
}

export function legalCode(code: number): boolean {
  if (!(code <= 0x10ffff) || code === 0xb || code === 0xc) return false
  return legalXml(String.fromCodePoint(code)) !== ''
}
