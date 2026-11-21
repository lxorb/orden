export interface Line {
  at: number
  from: string
  body: string
  typing?: number
}
export const PEOPLE = [
  { id: 'mara', name: 'Mara Lind' },
  { id: 'jonas', name: 'Jonas Weber' },
  { id: 'aiko', name: 'Aiko Tan' },
] as const
export const CHAT_NAME = 'Ride test'
export const BEFORE: readonly Omit<Line, 'at'>[] = [
  { from: 'jonas', body: 'Ride test is on for **Saturday, 09:00** at the river.' },
  { from: 'mara', body: 'I will bring the spare battery.' },
  { from: 'aiko', body: 'Photos at the bridge first, then the old town.' },
]
export const DURING: readonly Line[] = [
  { at: 0.3, from: 'jonas', body: 'Forecast is dry, 12 degrees at nine.', typing: 0.1 },
  { at: 0.58, from: 'aiko', body: 'Perfect light for the Ember frame.', typing: 0.42 },
  { at: 0.8, from: 'mara', body: 'See you there!' },
]
export function chatAt(phase: number): { said: number; typing: string | null } {
  const said = DURING.filter((one) => phase >= one.at).length
  const next = DURING[said]
  const typing = next?.typing !== undefined && phase >= next.typing ? next.from : null
  return { said, typing }
}
