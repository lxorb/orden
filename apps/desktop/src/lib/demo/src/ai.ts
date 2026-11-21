import type { Part, Turn } from '../../ai-providers/src/api'

interface Said {
  at: number
  role: 'you' | 'model'
  part: (phase: number) => Part
}
const tool = (id: string, verb: string, args: unknown, from: number, to: number): Said => ({
  at: from,
  role: 'model',
  part: (phase) => ({ kind: 'tool', id, verb, args, state: phase < to ? 'running' : 'ok' }),
})
export function scriptOf(page: string, routes: string): readonly Said[] {
  return [
    {
      at: 0.04,
      role: 'you',
      part: () => ({
        kind: 'text',
        text: 'Find the weekend routes on the Kestrel page and put each one on my todos for Saturday.',
      }),
    },
    {
      at: 0.12,
      role: 'model',
      part: () => ({ kind: 'thinking', text: 'The routes live on their own page.', ms: 900 }),
    },
    tool('open', 'browser_navigate', { url: routes, from: page }, 0.2, 0.32),
    tool('read', 'browser_read', { url: routes }, 0.36, 0.46),
    tool('one', 'add_task', { text: 'River loop, 14 km on Saturday' }, 0.5, 0.56),
    tool('two', 'add_task', { text: 'Old town, 9 km on Saturday' }, 0.56, 0.62),
    tool('three', 'add_task', { text: 'Harbour, 21 km on Saturday' }, 0.62, 0.68),
    {
      at: 0.72,
      role: 'model',
      part: () => ({ kind: 'text', text: 'Done: River loop, Old town and Harbour are on your todos for Saturday.' }),
    },
  ]
}
const AI_ENDS = 0.92
export function turnsAt(phase: number, script: readonly Said[]): Turn[] {
  if (phase >= AI_ENDS) return []
  const turns: Turn[] = []
  for (const one of script) {
    if (phase < one.at) break
    const last = turns.at(-1)
    if (last?.role === one.role) last.parts.push(one.part(phase))
    else {
      const part = one.part(phase)
      const draft = one.role === 'you' && part.kind === 'text' ? { draft: { text: part.text, attachments: [] } } : {}
      turns.push({ id: `demo-${turns.length}`, role: one.role, at: 0, parts: [part], ...draft })
    }
  }
  return turns
}
export const browsing = (phase: number): 'page' | 'routes' => (phase >= 0.32 && phase < AI_ENDS ? 'routes' : 'page')
export const working = (phase: number): boolean => phase >= 0.12 && phase < 0.72
