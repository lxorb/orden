export type Mood =
  | 'happy'
  | 'unsure'
  | 'crying'
  | 'proud'
  | 'shrug'
  | 'bored'
  | 'sleepy'
  | 'thinking'
  | 'offline'
  | 'lost'
  | 'suspicious'
  | 'stern'
  | 'shocked'
  | 'dizzy'
  | 'nervous'
  | 'relieved'
  | 'cool'
  | 'love'
  | 'excited'
  | 'waving'
  | 'hug'
  | 'flexing'
  | 'innocent'
type Prop = 'zzz' | 'dots' | 'sweat' | 'question' | 'note' | 'sparkle' | 'wave'
type Motion = 'bob' | 'tilt' | 'wobble' | 'pulse'
export interface Face {
  eyes: readonly [string, string]
  mouth: string
  arms: readonly [string, string]
  prop: Prop | null
}
export type Change = Partial<Face>
export interface Frame {
  change: Change
  ms: number
}
export interface Look {
  rest: Face
  motion: Motion | null
  moves: readonly (readonly Frame[])[]
}

const SMILE = ' \u035Cʖ'
const FROWN = ' ʖ\u032F'
const FLAT = ' \u035Fʖ'
const NONE = ['', ''] as const
const face = (eye: string, mouth = SMILE, more: Partial<Face> = {}): Face => ({
  eyes: [eye, eye],
  mouth,
  arms: NONE,
  prop: null,
  ...more,
})
const eyes = (left: string, right = left, ms = 140): Frame => ({ change: { eyes: [left, right] }, ms })
const mouth = (shape: string, ms: number): Frame => ({ change: { mouth: shape }, ms })
const pause = (ms: number): Frame => ({ change: {}, ms })
const blink = [eyes('–')]
const doubleBlink = [eyes('–'), pause(120), eyes('–')]

export const LOOKS: Record<Mood, Look> = {
  happy: { rest: face('°'), motion: null, moves: [blink, blink, doubleBlink, [eyes('°', '–', 420)]] },
  unsure: { rest: face('°', FROWN), motion: null, moves: [blink, blink, [mouth(SMILE, 260)]] },
  crying: {
    rest: face('ಥ'),
    motion: null,
    moves: [[mouth(FROWN, 180)], [mouth(FROWN, 160), pause(110), mouth(FROWN, 200)]],
  },
  proud: {
    rest: face('ᵔ'),
    motion: 'bob',
    moves: [[eyes('°', '°', 360)], [{ change: { prop: 'sparkle' }, ms: 1100 }]],
  },
  shrug: {
    rest: face('°', SMILE, { arms: ['¯\\_', '_/¯'] }),
    motion: null,
    moves: [blink, blink, [{ change: { arms: ['_', '_'] }, ms: 380 }]],
  },
  bored: { rest: face('°', FLAT), motion: null, moves: [[eyes('–', '–', 520)], [eyes('◔', '◔', 700)]] },
  sleepy: { rest: face('–', SMILE, { prop: 'zzz' }), motion: 'bob', moves: [[eyes('°', '–', 700)]] },
  thinking: {
    rest: face('◔', FLAT, { prop: 'dots' }),
    motion: null,
    moves: [[mouth(FROWN, 500)], [eyes('°', '°', 300)]],
  },
  offline: { rest: face('◐', FLAT), motion: null, moves: [[eyes('◑', '◑', 700)], blink] },
  lost: { rest: face('°', FLAT, { prop: 'question' }), motion: 'tilt', moves: [blink, [mouth(FROWN, 400)]] },
  suspicious: { rest: face('≖'), motion: null, moves: [[eyes('°', '°', 300)], [mouth(FLAT, 400)]] },
  stern: { rest: face('ಠ', FROWN), motion: null, moves: [blink, [mouth(FLAT, 400)]] },
  shocked: { rest: face('◉', FROWN), motion: null, moves: [blink, [mouth(FLAT, 300)]] },
  dizzy: {
    rest: face('×'),
    motion: 'wobble',
    moves: [[eyes('@', '@', 500)], [mouth(FROWN, 300)]],
  },
  nervous: { rest: face('°', SMILE, { prop: 'sweat' }), motion: null, moves: [[mouth(FLAT, 300)], blink] },
  relieved: {
    rest: face('ᵕ'),
    motion: 'bob',
    moves: [[eyes('°', '°', 320)], [{ change: { prop: 'sweat' }, ms: 1400 }]],
  },
  cool: { rest: face('■'), motion: null, moves: [[eyes('°', '°', 400)], [mouth(FLAT, 300)]] },
  love: { rest: face('♡'), motion: 'pulse', moves: [blink] },
  excited: { rest: face('✧'), motion: 'bob', moves: [[eyes('✦', '✦', 220), pause(140), eyes('✦', '✦', 220)]] },
  waving: {
    rest: face('°', SMILE, { prop: 'wave' }),
    motion: null,
    moves: [blink, [eyes('°', '–', 420)]],
  },
  hug: {
    rest: face('°', SMILE, { arms: ['(づ', 'づ'] }),
    motion: null,
    moves: [blink, [{ change: { arms: ['(っ', 'っ'] }, ms: 600 }]],
  },
  flexing: {
    rest: face('°', SMILE, { arms: ['ᕦ', 'ᕤ'] }),
    motion: 'bob',
    moves: [blink, [eyes('°', '–', 420)]],
  },
  innocent: {
    rest: face('°', ' ε', { prop: 'note' }),
    motion: null,
    moves: [[eyes('◐', '◐', 600)], blink],
  },
}
export const MOODS = Object.keys(LOOKS) as Mood[]
const BROW = ' \u0361'
export function glyph(one: Face): string {
  const opening = one.arms[0].startsWith('(') ? one.arms[0] : `${one.arms[0]}(`
  return `${opening}${BROW}${one.eyes[0]}${one.mouth}${BROW}${one.eyes[1]})${one.arms[1]}`
}
export function changed(rest: Face, change: Change): Face {
  return { ...rest, ...change }
}
