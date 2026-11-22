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
export const CREW_NAME = 'Shop crew'
export const REPLY = 'Framing this one for the office.'
export const CREW: readonly Omit<Line, 'at'>[] = [
  { from: 'jonas', body: 'Shop window is up. Three bikes, one per colour.' },
  { from: 'aiko', body: 'The orange one stops people. Two asked inside already.' },
  { from: 'mara', body: 'Opening is Friday 18:00, music at 19:00.' },
  { from: 'jonas', body: 'I will bring the speakers.' },
]
export const BEFORE: readonly Omit<Line, 'at'>[] = [
  { from: 'jonas', body: 'Ride test went great. 48 minutes on the river loop.' },
  { from: 'mara', body: 'And now: launch LAN at mine.' },
]
export const TIMES = { open: 1700, composer: 13600, typing: 14100, back: 25600, end: 28400 }
export function duringOf(picture: string, sent: number): readonly Line[] {
  return [
    {
      at: 5000,
      from: 'aiko',
      body: `me and the boys\n\n![Four friends at a LAN party table](${picture})`,
      typing: 3000,
    },
    { at: 12000, from: 'jonas', body: 'The pizza is load-bearing.', typing: 10000 },
    { at: sent, from: 'mara', body: REPLY },
  ]
}
export const reactionsOf = (sent: number): readonly Reaction[] => [
  { at: 6200, line: 0, from: 'jonas', emoji: '😂' },
  { at: 7400, line: 0, from: 'mara', emoji: '🍕' },
  { at: 9300, line: 0, from: 'jonas', emoji: '🔥' },
  { at: sent + 1800, line: 1, from: 'aiko', emoji: '🙌' },
]
export function chatAt(
  ms: number,
  during: readonly Line[],
  reactions: readonly Reaction[],
): { said: number; typing: string | null; reacted: number } {
  const said = during.filter((one) => ms >= one.at).length
  const next = during[said]
  const typing = next?.typing !== undefined && ms >= next.typing ? next.from : null
  const reacted = reactions.filter((one) => ms >= one.at).length
  return { said, typing, reacted }
}
