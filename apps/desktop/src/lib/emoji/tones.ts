export const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'] as const

export type Tone = 0 | 1 | 2 | 3 | 4 | 5

export function inTone(emoji: string, tone: Tone, toned: ReadonlySet<string>): string {
  if (tone === 0 || !toned.has(emoji)) return emoji
  const [first, ...rest] = Array.from(emoji)
  if (first === undefined) return emoji
  const after = rest[0] === '️' ? rest.slice(1) : rest
  return `${first}${TONES[tone]}${after.join('')}`
}
