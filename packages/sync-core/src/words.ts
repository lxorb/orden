const LETTERS = /^[\p{L}\p{N}\p{M}_]$/u
const UNSPACED = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u

export function isWordChar(char: string): boolean {
  return char !== '' && LETTERS.test(char) && !UNSPACED.test(char)
}

export function charBefore(text: string, at: number): string {
  if (at <= 0) return ''
  const low = text.charCodeAt(at - 1)
  if (at >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(at - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(at - 2, at)
  }
  return text.charAt(at - 1)
}

export function charAt(text: string, at: number): string {
  if (at >= text.length) return ''
  const code = text.codePointAt(at) ?? 0
  return String.fromCodePoint(code)
}

export function wordStart(text: string, at: number): number {
  let place = at
  for (let char = charBefore(text, place); isWordChar(char); char = charBefore(text, place)) {
    place -= char.length
  }
  return place
}

export function wordEnd(text: string, at: number): number {
  let place = at
  for (let char = charAt(text, place); isWordChar(char); char = charAt(text, place)) {
    place += char.length
  }
  return place
}

export function tokens(text: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    const char = charAt(text, at)
    let end = at + char.length
    if (isWordChar(char)) end = wordEnd(text, at)
    else if (/^\s$/u.test(char)) while (end < text.length && /^\s$/u.test(text.charAt(end))) end++
    out.push(text.slice(at, end))
    at = end
  }
  return out
}
