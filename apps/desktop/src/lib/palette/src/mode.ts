export type PaletteMode = 'everything' | 'commands' | 'headings' | 'line' | 'hosts'

const MARKS: Record<string, PaletteMode> = {
  '>': 'commands',
  '#': 'headings',
  ':': 'line',
}

const SSH = /^ssh\s+/i

export function modeOf(query: string): { mode: PaletteMode; term: string } {
  const ssh = SSH.exec(query)
  if (ssh) return { mode: 'hosts', term: query.slice(ssh[0].length).trim() }

  const mode = MARKS[query.charAt(0)]
  return mode ? { mode, term: query.slice(1).trim() } : { mode: 'everything', term: query.trim() }
}

export function lineAsked(term: string, lines: number): number | null {
  if (!/^\d+$/.test(term) || lines < 1) return null

  return Math.min(Math.max(Number(term), 1), lines) - 1
}
