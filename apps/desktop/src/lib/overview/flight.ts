import { type Feel, FLIGHT, land, resting, SHARE, type Spring, spring, step } from './spring'

export interface Pose {
  x: number
  y: number
  w: number
  h: number
  tab: number
  alpha: number
}

const KEYS = ['x', 'y', 'w', 'h', 'tab', 'alpha'] as const

const TAB_RADIUS = 8

export class Flight {
  private readonly springs: Record<keyof Pose, Spring>

  constructor(from: Pose) {
    this.springs = {
      x: spring(from.x),
      y: spring(from.y),
      w: spring(from.w),
      h: spring(from.h),
      tab: spring(from.tab, SHARE),
      alpha: spring(from.alpha, SHARE),
    }
  }

  aim(to: Pose) {
    for (const key of KEYS) this.springs[key].to = to[key]
  }

  hold(x: number, y: number, w: number, h: number) {
    for (const [key, value] of [
      ['x', x],
      ['y', y],
    ] as const) {
      const one = this.springs[key]
      one.at = one.to = value
      one.speed = 0
    }
    this.springs.w.to = w
    this.springs.h.to = h
    this.springs.tab.to = 0
    this.springs.alpha.to = 1
  }

  land() {
    for (const key of KEYS) land(this.springs[key])
  }

  step(seconds: number, feel: Feel = FLIGHT): boolean {
    let still = true
    for (const key of KEYS) {
      step(this.springs[key], seconds, feel)
      still &&= resting(this.springs[key])
    }
    return still
  }

  get pose(): Pose {
    const { x, y, w, h, tab, alpha } = this.springs
    return { x: x.at, y: y.at, w: w.at, h: h.at, tab: tab.at, alpha: alpha.at }
  }

  get resting(): boolean {
    return KEYS.every((key) => resting(this.springs[key]))
  }
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function drawn(
  pose: Pose,
  wide: number,
  tall: number,
  corner: number,
  camera: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 },
) {
  const { zoom } = camera
  const sx = Math.max(pose.w, 1) / wide
  const sy = Math.max(pose.h, 1) / tall
  const tab = clamp(pose.tab)
  const radius = corner + (TAB_RADIUS - corner) * tab
  const x = camera.x + pose.x * zoom
  const y = camera.y + pose.y * zoom
  return {
    window: {
      transform: `translate(${x}px, ${y}px) scale(${sx * zoom}, ${sy * zoom})`,
      borderRadius: `${radius / sx}px / ${radius / sy}px`,
      opacity: String(clamp(pose.alpha)),
    },
    face: { opacity: String(clamp(1 - (tab - 0.35) / 0.55)) },
    chip: {
      opacity: String(clamp((tab - 0.35) / 0.55)),
      width: `${Math.max(pose.w, 1) * zoom}px`,
      height: `${Math.max(pose.h, 1) * zoom}px`,
      transform: `scale(${1 / (sx * zoom)}, ${1 / (sy * zoom)})`,
    },
  }
}

export function paneDrawn(
  pose: Pose,
  camera: { x: number; y: number; zoom: number },
  box: { x: number; y: number; width: number; height: number },
  head: number,
  corner: number,
  open: number,
) {
  const x = camera.x + pose.x * camera.zoom
  const y = camera.y + pose.y * camera.zoom
  const w = Math.max(pose.w * camera.zoom, 1)
  const h = Math.max(pose.h * camera.zoom, 1)
  const scale = w / Math.max(box.width, 1)
  const shown = Math.max(box.height - head, 1)
  const cut = head * clamp(open)
  const below = Math.max(0, shown - h / scale)
  return {
    transform: `translate(${x - box.x}px, ${y - box.y - scale * head}px) scale(${scale})`,
    clipPath: `inset(${cut}px 0 ${below}px 0 round ${corner / scale}px)`,
    opacity: String(clamp(pose.alpha)),
  }
}
