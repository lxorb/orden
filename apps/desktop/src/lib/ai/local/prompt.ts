import type { Message } from '../providers'

export function promptFor(messages: readonly Message[]): string {
  const rules = messages.filter((one) => one.role === 'system').map((one) => one.content)
  const said = messages.filter((one) => one.role !== 'system')
  const question = said.at(-1)
  const before = said.slice(0, -1)

  const parts: string[] = []
  if (rules.length) parts.push(`<instructions>\n${rules.join('\n\n')}\n</instructions>`)
  if (before.length) {
    const turns = before.map((one) => `<${one.role}>\n${one.content}\n</${one.role}>`)
    parts.push(`<conversation>\n${turns.join('\n')}\n</conversation>`)
  }
  if (question) parts.push(`<${question.role}>\n${question.content}\n</${question.role}>`)
  return parts.join('\n\n')
}
