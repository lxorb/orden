import { startInsets } from './insets'
import { isMobile } from './platform/src/api'

export type Device = 'phone' | 'tablet' | 'desktop'

const PHONE_SIDE = 500
const NARROW = 460

const KEYBOARD_THRESHOLD = 120

const FINGER = '(hover: none) and (pointer: coarse)'

const HANDHELD =
  /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|BlackBerry|Opera Mini|IEMobile|Macintosh/

export interface Machine {
  native: boolean
  handheld: boolean | null
  agent: string
  finger: boolean
}

export function deviceFor(width: number, height: number, machine: Machine): Device {
  if (!machine.native && !handheld(machine)) return 'desktop'

  return Math.min(width, height) <= PHONE_SIDE ? 'phone' : 'tablet'
}

const DESKTOP = /Windows NT|X11|CrOS/

function handheld(machine: Machine): boolean {
  if (!machine.finger || DESKTOP.test(machine.agent)) return false

  return machine.handheld === true || HANDHELD.test(machine.agent)
}

interface UserAgentData {
  mobile?: boolean
}

class Viewport {
  keyboard = $state(0)
  typing = $state(false)
  covered = $state(0)
  panned = $state(0)
  height = $state(0)
  device = $state<Device>('desktop')
  portrait = $state(false)
  narrow = $state(false)
  installed = $state(false)

  touch = $derived(this.device !== 'desktop')
  drawer = $derived(this.device === 'phone' || (this.device === 'tablet' && this.portrait))

  private started = false
  private glass: MediaQueryList | null = null

  private tallest = 0
  private atWidth = 0

  start() {
    if (this.started || typeof window === 'undefined') return
    this.started = true

    startInsets()

    const shape = () => this.shape()

    this.glass = window.matchMedia(FINGER)
    this.glass.addEventListener('change', shape)

    this.shape()
    window.addEventListener('resize', shape)
    window.addEventListener('orientationchange', shape)

    const standalone = window.matchMedia('(display-mode: standalone)')
    this.installed = isMobile || standalone.matches
    standalone.addEventListener('change', (event) => (this.installed = isMobile || event.matches))

    const seen = window.visualViewport
    if (!seen) return

    const measure = () => this.measure(seen)

    measure()
    seen.addEventListener('resize', measure)
    seen.addEventListener('scroll', measure)
  }

  private shape() {
    const width = window.innerWidth
    const height = window.innerHeight
    this.device = deviceFor(width, height, this.machine())
    this.portrait = height >= width
    this.narrow = width <= NARROW

    const root = document.documentElement
    root.dataset.device = this.device
    root.toggleAttribute('data-touch', this.touch)
    root.toggleAttribute('data-drawer', this.drawer)
    root.toggleAttribute('data-narrow', this.narrow)
  }

  private machine(): Machine {
    const said: (Navigator & { userAgentData?: UserAgentData }) | null =
      typeof navigator === 'undefined' ? null : navigator
    const hints = said?.userAgentData

    return {
      native: isMobile,
      handheld: typeof hints?.mobile === 'boolean' ? hints.mobile : null,
      agent: said?.userAgent ?? '',
      finger: this.glass?.matches ?? false,
    }
  }

  private measure(seen: VisualViewport) {
    const slid = this.touch && seen.offsetTop > 0 && Math.abs(seen.scale - 1) < 0.01
    if (slid) {
      window.scrollTo(0, 0)
      this.panned++
    }

    const layout = document.documentElement.clientHeight
    const hidden = layout - (seen.height + (slid ? 0 : seen.offsetTop))
    this.keyboard = Math.max(0, Math.round(hidden))
    this.height = Math.round(seen.height)
    document.documentElement.style.setProperty('--keyboard', `${this.keyboard}px`)

    const full = this.height + this.keyboard
    if (seen.width !== this.atWidth) {
      this.atWidth = seen.width
      this.tallest = 0
    }
    this.tallest = Math.max(this.tallest, full)

    const shorter = isMobile ? this.tallest - full : 0
    this.typing = Math.max(this.keyboard, shorter) > KEYBOARD_THRESHOLD
  }
}

export function showField(field: HTMLElement, scroller: HTMLElement, bottom: number) {
  const box = field.getBoundingClientRect()
  const seen = scroller.getBoundingClientRect()
  const top = seen.top + FIELD_MARGIN
  const end = Math.min(seen.bottom, bottom) - FIELD_MARGIN

  if (box.bottom > end) scroller.scrollTop += Math.min(box.bottom - end, box.top - top)
  else if (box.top < top) scroller.scrollTop -= top - box.top
}

export function scrollerOf(field: HTMLElement): HTMLElement | null {
  if (field.closest('.cm-editor')) return null

  for (let at = field.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) {
      return at
    }
  }

  return null
}

const FIELD_MARGIN = 24

export const viewport = new Viewport()

export function pageHeight(): string | undefined {
  return viewport.touch && viewport.height ? `${viewport.height}px` : undefined
}
