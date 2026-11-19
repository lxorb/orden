export const DEMO_SCENES = ['canvas', 'write', 'browse', 'organize', 'overview'] as const
export type DemoScene = (typeof DEMO_SCENES)[number]
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
