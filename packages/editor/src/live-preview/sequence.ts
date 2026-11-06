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

function asParticipant(line: string): string {
  return line.replace(/^participant\b/i, 'participant')
}

function asMessage(line: string): string | null {
  const match = /^(.+?)(-->>|->>|-->|->|--|-)\s*(.+?)\s*:\s*(.*)$/.exec(line)
  if (!match) return null

  const [, from = '', arrow = '', to = '', text = ''] = match
  const dashed = arrow.startsWith('--')
  const mermaidArrow = dashed ? '-->>' : '->>'

  return `${clean(from)}${mermaidArrow}${clean(to)}: ${text}`
}

function clean(name: string): string {
  return name.trim().replace(/[:;]/g, '')
}
