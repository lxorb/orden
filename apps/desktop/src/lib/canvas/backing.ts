export type InkMode = 'latency' | 'plain'

const SETTINGS: Record<InkMode, CanvasRenderingContext2DSettings> = {
  latency: { alpha: true, desynchronized: true, willReadFrequently: false },
  plain: { alpha: true, desynchronized: false, willReadFrequently: false },
}

const OVERLAID = /android/i

const AGENT = typeof navigator === 'undefined' ? '' : navigator.userAgent

export interface InkBacking {
  agent: string
  reported: CanvasRenderingContext2DSettings | null
}

export function inkMode({ agent, reported }: InkBacking): InkMode {
  if (OVERLAID.test(agent)) return 'plain'

  if (!reported) return 'latency'

  if (reported.alpha === false) return 'plain'

  if (reported.desynchronized === false) return 'plain'

  return 'latency'
}

export function wantedInkMode(): InkMode {
  return inkMode({ agent: AGENT, reported: null })
}

const announced = new Set<string>()

function announce(mode: InkMode, wanted: InkMode) {
  const line =
    mode === wanted ? `nib ink: ${mode} backing` : `nib ink: ${mode} backing, ${wanted} refused`
  if (announced.has(line)) return

  announced.add(line)
  // eslint-disable-next-line no-console -- The line the device is diagnosed from.
  console.info(line)
}

export interface InkLayer {
  context: CanvasRenderingContext2D
  mode: InkMode
}

export function inkLayer(canvas: HTMLCanvasElement, wanted: InkMode): InkLayer | null {
  const context = canvas.getContext('2d', SETTINGS[wanted])
  if (!context) return null

  const reported = 'getContextAttributes' in context ? context.getContextAttributes() : null

  const mode = wanted === 'latency' ? inkMode({ agent: AGENT, reported }) : wanted
  announce(mode, wanted)
  return { context, mode }
}
