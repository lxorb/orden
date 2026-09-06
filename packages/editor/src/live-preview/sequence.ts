/** Typora's legacy ` ```sequence ` fences, in js-sequence-diagrams syntax.
 *
 *  That library has been unmaintained for years and its npm package is no
 *  longer safe to depend on, so the diagram is translated into Mermaid's
 *  `sequenceDiagram` instead - the same picture, drawn by a renderer that is
 *  still looked after. */
export function sequenceToMermaid(source: string): string {
  const out = ['sequenceDiagram']

  for (const raw of source.split('\n')) {
    const line = raw.trim()

    // A title is a heading in js-sequence and an autonumber-style directive in
    // Mermaid; the closest honest translation is Mermaid's own title.
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

/** `participant A as Alice` carries over unchanged; the bare form does too. */
function asParticipant(line: string): string {
  return line.replace(/^participant\b/i, 'participant')
}

/** js-sequence writes `A->B: hi`; Mermaid wants `A->>B: hi`. The dashed and
 *  open-arrow forms map the same way. */
function asMessage(line: string): string | null {
  const match = /^(.+?)(-->>|->>|-->|->|--|-)\s*(.+?)\s*:\s*(.*)$/.exec(line)
  if (!match) return null

  // Every group is required by the pattern, so a match has them all; the
  // defaults are what satisfies a compiler that cannot see that.
  const [, from = '', arrow = '', to = '', text = ''] = match
  const dashed = arrow.startsWith('--')
  const mermaidArrow = dashed ? '-->>' : '->>'

  return `${clean(from)}${mermaidArrow}${clean(to)}: ${text}`
}

/** Names go in as written, minus anything Mermaid would read as syntax. */
function clean(name: string): string {
  return name.trim().replace(/[:;]/g, '')
}
