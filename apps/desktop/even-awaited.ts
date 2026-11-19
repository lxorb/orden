const AWAITED = /\{#await (import\(['"][^'"]+['"]\)) then (\{[^}]*\}|[A-Za-z_$][\w$]*)\}([\s\S]*?)\{\/await\}/g
function namesTaken(bound: string, body: string): string[] {
  if (bound.startsWith('{')) {
    return bound
      .slice(1, -1)
      .split(',')
      .map((one) => one.split(':')[0]?.trim() ?? '')
      .filter(Boolean)
  }
  const uses = [...body.matchAll(new RegExp(`(?<![\\w$.])${bound}\\b(\\.[\\w$]+)?`, 'g'))]
  if (!uses.length || uses.some((one) => !one[1])) return []
  return [...new Set(uses.map((one) => (one[1] ?? '').slice(1)))]
}
export function awaitedOnly(code: string): string | null {
  const narrowed = code.replace(AWAITED, (whole, call: string, bound: string, body: string) => {
    const names = namesTaken(bound, body)
    if (!names.length) return whole
    const picked = names.map((name) => `${JSON.stringify(name)}: one.${name}`).join(', ')
    return whole.replace(call, `${call}.then((one) => ({ ${picked} }))`)
  })
  return narrowed === code ? null : narrowed
}
