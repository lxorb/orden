const firstLine = (body: string) => body.split('\n')[0] ?? ''

const NAME_WORDS = 8
const NAME_LENGTH = 60

export function taskWords(body: string, called: readonly string[]): string {
  let line = firstLine(body).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
  for (const name of called) line = line.split(`@${name}`).join(' ')
  line = line.replace(/\s+/g, ' ').trim()
  const people = called.map((name) => `+${name.split(/\s+/)[0] ?? name}`)
  return [line, ...people].filter(Boolean).join(' ')
}

export function noteNameOf(body: string, fallback: string): string {
  const words = firstLine(body)
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, NAME_WORDS)
    .join(' ')
    .slice(0, NAME_LENGTH)
    .trim()
  return words || fallback
}

export function quoted(who: string, at: string, body: string, files: readonly string[]): string {
  const lines = [
    `**${who}** · ${at}`,
    ...(body ? body.split('\n') : []),
    ...files.map((one) => `![[${one}]]`),
  ]
  return lines.map((line) => (line ? `> ${line}` : '>')).join('\n')
}
