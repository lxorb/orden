export interface Line {
  at: number
  from: string
  body: string
  typing?: number
  picture?: string
}
export interface Reaction {
  at: number
  line: number
  from: string
  emoji: string
}
export const PEOPLE = [
  { id: 'mara', name: 'Mara Lind' },
  { id: 'jonas', name: 'Jonas Weber' },
  { id: 'aiko', name: 'Aiko Tan' },
] as const
export const CHAT_NAME = 'Ride test'
export const BEFORE: readonly Omit<Line, 'at'>[] = [
  { from: 'jonas', body: 'Ride test went great. 48 minutes on the river loop.' },
  { from: 'mara', body: 'And now: launch LAN at mine.' },
]
export function duringOf(picture: string): readonly Line[] {
  return [
    {
      at: 0.22,
      from: 'aiko',
      body: `me and the boys\n\n![Four friends at a LAN party table](${picture})`,
      typing: 0.08,
    },
    { at: 0.46, from: 'jonas', body: 'The pizza is load-bearing.', typing: 0.36 },
    { at: 0.72, from: 'mara', body: 'Framing this one for the office.' },
  ]
}
export const REACTIONS: readonly Reaction[] = [
  { at: 0.3, line: 0, from: 'jonas', emoji: '😂' },
  { at: 0.36, line: 0, from: 'mara', emoji: '🍕' },
  { at: 0.52, line: 0, from: 'jonas', emoji: '🔥' },
  { at: 0.8, line: 1, from: 'aiko', emoji: '🙌' },
]
export function chatAt(
  phase: number,
  during: readonly Line[],
): { said: number; typing: string | null; reacted: number } {
  const said = during.filter((one) => phase >= one.at).length
  const next = during[said]
  const typing = next?.typing !== undefined && phase >= next.typing ? next.from : null
  const reacted = REACTIONS.filter((one) => phase >= one.at).length
  return { said, typing, reacted }
}
