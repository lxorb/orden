function codePoints(emoji: string): string {
  return Array.from(emoji, (one) => (one.codePointAt(0) ?? 0).toString(16).padStart(4, '0')).join(
    '-',
  )
}

export function plain(emoji: string): string {
  return emoji.replace(/️/g, '')
}

export function outlineName(
  emoji: string,
  slug: string,
  chars: Readonly<Record<string, string>>,
): string {
  return chars[codePoints(emoji)] ?? chars[codePoints(plain(emoji))] ?? slug.replace(/_/g, '-')
}

export const FILLS_ITS_BOX: ReadonlySet<string> = new Set(['face-in-clouds'])
