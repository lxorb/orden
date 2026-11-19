import { DEMO_SCENES, type DemoCue, type DemoScene } from './demo-cue'

export interface Track {
  rise: number
  span: number
}
interface StoryPoint {
  rise: number
  into: number
  scene: DemoScene
  at: number
}
interface Frame {
  lift: number
  shrink: number
  hero: number
  captions: number[]
  close: number
}
const LAST = DEMO_SCENES.length - 1
const FADE = 0.08
const LEAVE = 0.86
const clamp = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => {
  const t = clamp(x)
  return t * t * (3 - 2 * t)
}
const step = (x: number) => (x >= 0.5 ? 1 : 0)
export function storyAt(scrolled: number, track: Track): StoryPoint {
  const rise = track.rise > 0 ? clamp(scrolled / track.rise) : 1
  const into = track.span > 0 ? (scrolled - track.rise) / track.span : 0
  const chapter = Math.min(LAST, Math.max(0, Math.floor(into)))
  return { rise, into, scene: DEMO_SCENES[chapter] ?? 'canvas', at: into < 0 ? 0 : clamp(into - chapter) }
}
export function frameOf(point: StoryPoint, still: boolean): Frame {
  const ease = still ? (x: number) => step(clamp(x)) : smooth
  const captions = DEMO_SCENES.map((_, index) => {
    const x = point.into - index
    const shown = ease((x + FADE) / FADE)
    const gone = index === LAST ? 0 : ease((x - LEAVE) / FADE)
    return shown * (1 - gone)
  })
  const closing = point.into - LAST
  return {
    lift: still ? 1 : smooth(point.rise),
    hero: still ? 1 : 1 - smooth(point.rise / 0.55),
    captions,
    shrink: ease((closing - 0.5) / 0.35),
    close: ease((closing - 0.62) / 0.3),
  }
}
export function cueOf(point: StoryPoint, still: boolean): DemoCue {
  return { orden: 'demo', scene: point.scene, at: point.at, still }
}
export function deviceTransform(frame: Frame, drop: number): string {
  const scale = (0.9 + 0.1 * frame.lift) * (1 - 0.2 * frame.shrink)
  const lowered = (1 - frame.lift) * drop
  return `translate3d(0, ${lowered.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
}
