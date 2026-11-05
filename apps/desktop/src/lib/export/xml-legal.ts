/** What XML 1.0 has no way to say, which text pasted from Word, PowerPoint or a PDF carries.
 *  A strict reader refuses a whole file over one, and escaping does not help: the reference
 *  to one is as illegal as the character. */

/** Everything outside XML 1.0's `Char`, lone surrogates among it. */
const ILLEGAL = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu

/** The text with those gone. A vertical tab and a form feed part words, as the soft break
 *  they are in Word and PowerPoint, so those become a space; the rest are nothing. */
export function legalXml(text: string): string {
  return text.replace(/[\v\f]/g, ' ').replace(ILLEGAL, '')
}

/** Whether a numbered character reference names a character XML can carry. A vertical tab
 *  or a form feed so written is as illegal as the rest. */
export function legalCode(code: number): boolean {
  if (!(code <= 0x10ffff) || code === 0xb || code === 0xc) return false
  return legalXml(String.fromCodePoint(code)) !== ''
}
