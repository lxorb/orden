export const DEMO_SCENES = ['canvas', 'write', 'browse', 'organize', 'overview'] as const
type DemoScene = (typeof DEMO_SCENES)[number]
export interface DemoCue {
  orden: 'demo'
  scene: DemoScene
  at: number
  still?: boolean
}
interface DemoReady {
  orden: 'demo'
  ready: true
}
export const DEMO_SRC = '/?demo'
export const DEMO_PHONE_SRC = '/?demo=phone'
const said = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null && (data as { orden?: unknown }).orden === 'demo'
function isDemoScene(scene: unknown): scene is DemoScene {
  return DEMO_SCENES.includes(scene as DemoScene)
}
export function isDemoCue(data: unknown): data is DemoCue {
  if (!said(data)) return false
  const { scene, at, still } = data
  return (
    isDemoScene(scene) &&
    typeof at === 'number' &&
    Number.isFinite(at) &&
    at >= 0 &&
    at <= 1 &&
    (still === undefined || typeof still === 'boolean')
  )
}
export function isDemoReady(data: unknown): data is DemoReady {
  return said(data) && data.ready === true
}
export const DEMO_LOOP_SCENES = [
  'flow',
  'canvas',
  'markdown',
  'pages',
  'bubbles',
  'ai',
  'todos',
  'chat',
  'search',
] as const
export type DemoLoopScene = (typeof DEMO_LOOP_SCENES)[number]
export interface DemoPlay {
  orden: 'demo'
  play?: boolean
  still?: true
}
export function isDemoLoopScene(scene: unknown): scene is DemoLoopScene {
  return DEMO_LOOP_SCENES.includes(scene as DemoLoopScene)
}
export function demoLoopSrc(scene: DemoLoopScene, phone: boolean): string {
  return `/?demo=${scene}&loop${phone ? '&phone' : ''}`
}
export function isDemoPlay(data: unknown): data is DemoPlay {
  if (!said(data)) return false
  const { play, still } = data
  if (play !== undefined && typeof play !== 'boolean') return false
  if (still !== undefined && still !== true) return false
  return (play === undefined) !== (still === undefined)
}
