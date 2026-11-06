export interface Word {
  raw: string
  key: string
  from: number
  to: number
}

export function wordsOf(text: string): Word[] {
  const out: Word[] = []
  for (const found of text.matchAll(/\S+/gu)) {
    const raw = found[0]
    out.push({
      raw,
      key: raw.toLowerCase().replace(/[,;]+$/u, ''),
      from: found.index,
      to: found.index + raw.length,
    })
  }
  return out
}

export const bare = (word: Word | undefined): string => (word?.key ?? '').replace(/\.$/u, '')

function phraseAt(words: readonly Word[], at: number, phrase: readonly string[]): boolean {
  return phrase.every((one, index) => bare(words[at + index]) === one)
}

export function longestAt(
  words: readonly Word[],
  at: number,
  phrases: readonly (readonly string[])[],
): number {
  let most = 0
  for (const phrase of phrases) {
    if (phrase.length > most && phraseAt(words, at, phrase)) most = phrase.length
  }
  return most
}
