const AI_LANGUAGE = 'ai'

export const isAiLanguage = (language: string): boolean => language.trim().toLowerCase() === AI_LANGUAGE

export const ANSWER_OPEN = '<!--orden:ai-->'
export const ANSWER_CLOSE = '<!--/orden:ai-->'
const OPENS = new Set([ANSWER_OPEN, '<!--nib:ai-->'])
const CLOSES = new Set([ANSWER_CLOSE, '<!--/nib:ai-->'])
const NOTE_MENTION = /@note\b/i
export const mentionsNote = (prompt: string): boolean => NOTE_MENTION.test(prompt)

export function answerSpan(
  lines: readonly string[],
  closeLine: number,
  lead = '',
): { from: number; to: number } | null {
  const bare = (line: string | undefined) => {
    const text = line ?? ''
    if (lead && text.startsWith(lead)) return text.slice(lead.length).trim()
    if (lead && text.startsWith(lead.trimEnd())) return text.slice(lead.trimEnd().length).trim()
    return text.trim()
  }
  let at = closeLine + 1
  while (at < lines.length && bare(lines[at]) === '') at++

  if (!OPENS.has(bare(lines[at]))) return null
  const opened = at

  at++
  while (at < lines.length && !CLOSES.has(bare(lines[at]))) {
    if (OPENS.has(bare(lines[at]))) return null
    at++
  }
  if (at >= lines.length) return null
  const closed = at

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

const attribution = (label: string): string => `*${label}*`

export function answerParts(label: string): { head: string; tail: string } {
  return { head: `${ANSWER_OPEN}\n${attribution(label)}\n\n`, tail: `\n${ANSWER_CLOSE}` }
}

export function answerText(label: string, answer: string): string {
  const { head, tail } = answerParts(label)
  return `${head}${answer.replace(/\s+$/, '')}${tail}`
}
