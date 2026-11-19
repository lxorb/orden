export function sequenceToMermaid(source: string): string {
  const out = ['sequenceDiagram']
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (/^title\s*:/i.test(line)) {
      out.push(`  title ${line.slice(line.indexOf(':') + 1).trim()}`)
      continue
    }
    if (!line || line.startsWith('#')) continue
    if (/^participant\b/i.test(line)) {
      out.push(`  ${asParticipant(line)}`)
      continue
    }
    if (/^note\b/i.test(line)) {
      out.push(`  ${line}`)
      continue
    }
    const message = asMessage(line)
    if (message) out.push(`  ${message}`)
  }
  return out.join('\n')
}
const asParticipant = (line: string): string => line.replace(/^participant\b/i, 'participant')
function asMessage(line: string): string | null {
  const dash = line.indexOf('-', 1)
  if (dash === -1 || line.lastIndexOf(':') < dash + 2) return null
  const match = /^(.+?)(-->>|->>|-->|->|--|-)\s*(.+?)\s*:\s*(.*)$/.exec(line)
  if (!match) return null
  const [, from = '', arrow = '', to = '', text = ''] = match
  const dashed = arrow.startsWith('--')
  const mermaidArrow = dashed ? '-->>' : '->>'
  return `${clean(from)}${mermaidArrow}${clean(to)}: ${text}`
}
const clean = (name: string): string => name.trim().replace(/[:;]/g, '')
