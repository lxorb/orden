export interface ColourRule {
  when: string
  tone: string
}

export function colourExpression(rules: readonly ColourRule[]): string | undefined {
  if (!rules.length) return undefined
  return rules.reduceRight(
    (rest, rule) => `if(${rule.when}, ${JSON.stringify(rule.tone)}, ${rest})`,
    'null',
  )
}

function argumentsOf(text: string, from: number): { args: string[]; end: number } | null {
  const args: string[] = []
  let depth = 0
  let start = from
  let quote: string | null = null
  for (let at = from; at < text.length; at++) {
    const one = text[at]
    if (quote) {
      if (one === '\\') at++
      else if (one === quote) quote = null
      continue
    }
    if (one === '"' || one === "'") quote = one
    else if (one === '(' || one === '[' || one === '{') depth++
    else if (one === ')' && depth === 0) {
      args.push(text.slice(start, at).trim())
      return { args, end: at + 1 }
    } else if (one === ')' || one === ']' || one === '}') depth--
    else if (one === ',' && depth === 0) {
      args.push(text.slice(start, at).trim())
      start = at + 1
    }
  }
  return null
}

export function colourRules(expression: string | undefined): ColourRule[] | null {
  if (expression === undefined) return []
  const rules: ColourRule[] = []
  let rest = expression.trim()
  while (rest !== 'null') {
    if (!rest.startsWith('if(')) return null
    const call = argumentsOf(rest, 3)
    if (call?.end !== rest.length || call.args.length !== 3) return null
    const [when = '', tone = '', next = ''] = call.args
    if (!/^"(?:[^"\\]|\\.)*"$/.test(tone)) return null
    rules.push({ when, tone: String(JSON.parse(tone)) })
    rest = next
  }
  return rules
}
