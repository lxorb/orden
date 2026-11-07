const AI_LANGUAGE = 'ai'

export function isAiLanguage(language: string): boolean {
  return language.trim().toLowerCase() === AI_LANGUAGE
}

export const ANSWER_OPEN = '<!--orden:ai-->'
export const ANSWER_CLOSE = '<!--/orden:ai-->'
const OPENS = new Set([ANSWER_OPEN, '<!--nib:ai-->'])
const CLOSES = new Set([ANSWER_CLOSE, '<!--/nib:ai-->'])

const NOTE_MENTION = /@note\b/i

export function mentionsNote(prompt: string): boolean {
  return NOTE_MENTION.test(prompt)
}

export function answerSpan(
  lines: readonly string[],
  closeLine: number,
): { from: number; to: number } | null {
  let at = closeLine + 1
  while (at < lines.length && lines[at]?.trim() === '') at++

  if (!OPENS.has(lines[at]?.trim() ?? '')) return null
  const opened = at

  while (at < lines.length && !CLOSES.has(lines[at]?.trim() ?? '')) at++
  const closed = Math.min(at, lines.length - 1)

  return {
    from: offsetOf(lines, opened),
    to: offsetOf(lines, closed) + (lines[closed]?.length ?? 0),
  }
}

function offsetOf(lines: readonly string[], line: number): number {
  let at = 0
  for (let index = 0; index < line; index++) at += (lines[index]?.length ?? 0) + 1
  return at
}

function attribution(label: string): string {
  return `*${label}*`
}

export function answerParts(label: string): { head: string; tail: string } {
  return { head: `${ANSWER_OPEN}\n${attribution(label)}\n\n`, tail: `\n${ANSWER_CLOSE}` }
}

export function answerText(label: string, answer: string): string {
  const { head, tail } = answerParts(label)
  return `${head}${answer.replace(/\s+$/, '')}${tail}`
}
