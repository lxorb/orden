import type { DemoCue } from '../../showcase/src/api'
import { loopScenes, type LoopScene } from './loops'
import type { Stage } from './run'

type Draw = (cue: Pick<DemoCue, 'scene' | 'at' | 'still'>, now: number) => void
interface Heard {
  play?: boolean
  still?: boolean
}
function heard(data: unknown): Heard | null {
  if (typeof data !== 'object' || data === null || (data as { orden?: unknown }).orden !== 'demo') return null
  const { play, still } = data as { play?: unknown; still?: unknown }
  if (typeof play === 'boolean') return { play }
  if (still === true) return { still }
  return null
}
export async function loop(stage: Stage, draw: Draw, asked: string, site: string): Promise<void> {
  const scenes = loopScenes(stage, draw)
  const scene: LoopScene = scenes[asked] ?? scenes.canvas
  await scene.ready?.()
  let playing = true
  let still = false
  let spent = 0
  let last = performance.now()
  let ticking = false
  const phase = () => (still ? scene.still : (spent / scene.period) % 1)
  const tick = (now: number) => {
    if (playing && !still) spent += Math.min(100, now - last)
    last = now
    scene.tick(phase(), now)
    ticking = playing && !still
    if (ticking) requestAnimationFrame(tick)
  }
  const wake = () => {
    last = performance.now()
    if (!ticking) {
      ticking = true
      requestAnimationFrame(tick)
    }
  }
  addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== site || event.source !== parent) return
    const said = heard(event.data)
    if (!said) return
    if (said.still) {
      still = true
      scene.tick(phase(), performance.now())
      return
    }
    playing = said.play === true
    if (playing) wake()
  })
  scene.tick(phase(), performance.now())
  await new Promise((done) => requestAnimationFrame(done))
  await new Promise((done) => requestAnimationFrame(done))
  wake()
  parent.postMessage({ orden: 'demo', ready: true }, site)
}
