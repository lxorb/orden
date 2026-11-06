export interface Counts {
  words: number
  characters: number
  lines: number
  minutes: number
}

function isSpace(code: number): boolean {
  return (
    code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0x3000 || code === 0x200b
  )
}

export function countText(text: string): Counts {
  let words = 0
  let lines = text.length ? 1 : 0
  let inWord = false

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 10) lines++

    if (isSpace(code)) {
      inWord = false
    } else if (!inWord) {
      inWord = true
      words++
    }
  }

  return {
    words,
    characters: text.length,
    lines,
    minutes: Math.max(1, Math.round(words / 200)),
  }
}
