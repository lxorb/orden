import { demoLoopSrc, isDemoLoopScene, isDemoReady, type DemoLoopScene, type DemoPlay } from './demo-cue'
import {
  appHomeAt,
  downloadFor,
  LATEST_RELEASE_API,
  originsAt,
  releaseAssets,
  type AppHome,
  type Origins,
  type ReleaseAsset,
  type Visitor,
} from './links'
import { poolOf } from './pool'

const PHONE = '(max-width: 719.98px)'
const STILL = '(prefers-reduced-motion: reduce)'
const LIGHT = '(prefers-color-scheme: light)'
const DESKTOP_WIDTH = 1280
const PHONE_WIDTH = 390
const LIVE = 2
interface Agent {
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> }
}
interface Display {
  box: HTMLElement
  screen: HTMLElement
  scene: DemoLoopScene
  frame: HTMLIFrameElement | null
  ready: boolean
  playing: boolean
}
function displaysIn(doc: Document): Display[] {
  return [...doc.querySelectorAll<HTMLElement>('.display[data-scene]')].flatMap((box) => {
    const screen = box.querySelector<HTMLElement>('.screen')
    const { scene } = box.dataset
    if (!screen || !isDemoLoopScene(scene)) return []
    return [{ box, screen, scene, frame: null, ready: false, playing: false }]
  })
}
function followTheme(view: Window) {
  const light = view.matchMedia(LIGHT)
  const apply = () => {
    view.document.documentElement.dataset.theme = light.matches ? 'light' : 'dark'
  }
  apply()
  light.addEventListener('change', apply)
}
function offerDownload(view: Window, origins: Origins) {
  const { navigator } = view
  let visitor: Visitor = { userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints }
  let assets: ReleaseAsset[] = []
  const paint = () => {
    const { label, href } = downloadFor(visitor, assets)
    for (const link of view.document.querySelectorAll<HTMLAnchorElement>('a[data-download]')) {
      link.href = href
      const text = link.querySelector('[data-label]')
      if (text) text.textContent = label
    }
  }
  paint()
  for (const link of view.document.querySelectorAll<HTMLAnchorElement>('a[data-app]')) link.href = `${origins.app}/`
  const asked = (navigator as Agent).userAgentData?.getHighEntropyValues?.(['architecture'])
  asked?.then(
    ({ architecture }) => {
      if (!architecture) return
      visitor = { ...visitor, architecture }
      paint()
    },
    () => undefined,
  )
  whenIdle(view, () => {
    view
      .fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((answer) => (answer.ok ? answer.json() : null))
      .then((body: unknown) => {
        assets = releaseAssets(body)
        paint()
      })
      .catch(() => undefined)
  })
}
function whenIdle(view: Window, run: () => void) {
  const idle = (view as { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback
  const later = () => (idle ? idle.call(view, run, { timeout: 2500 }) : view.setTimeout(run, 300))
  if (view.document.readyState === 'complete') later()
  else view.addEventListener('load', later, { once: true })
}
export function showHome(view: Window, base: string = import.meta.env.BASE_URL) {
  const origins = originsAt(view.location)
  followTheme(view)
  offerDownload(view, origins)
  const displays = displaysIn(view.document)
  if (displays.length === 0) return
  const app: AppHome = appHomeAt(view.location, base)
  const phone = view.matchMedia(PHONE)
  const still = view.matchMedia(STILL)
  let started = false
  let asked = false
  const tell = (display: Display, said: Omit<DemoPlay, 'orden'>) => {
    display.frame?.contentWindow?.postMessage({ orden: 'demo', ...said } satisfies DemoPlay, app.origin)
  }
  const retire = (display: Display) => {
    display.frame?.remove()
    display.frame = null
    display.ready = false
    display.playing = false
    display.box.classList.remove('is-ready')
  }
  const enlist = (display: Display) => {
    const frame = view.document.createElement('iframe')
    frame.className = 'demo'
    frame.title = 'Orden, live'
    frame.tabIndex = -1
    frame.setAttribute('inert', '')
    frame.setAttribute('aria-hidden', 'true')
    frame.src = app.home + demoLoopSrc(display.scene, phone.matches)
    display.frame = frame
    display.screen.append(frame)
  }
  const settle = (display: Display, wanted: boolean) => {
    if (!display.ready || still.matches || display.playing === wanted) return
    display.playing = wanted
    tell(display, { play: wanted })
  }
  const render = () => {
    asked = false
    if (!started) return
    const height = view.innerHeight
    const spans = displays.map(({ box }) => {
      const { top, bottom } = box.getBoundingClientRect()
      return { top, bottom }
    })
    const { live, playing } = poolOf(spans, height, LIVE)
    const awake = view.document.visibilityState !== 'hidden'
    displays.forEach((display, index) => {
      const wanted = live.includes(index)
      if (!wanted && display.frame) retire(display)
      if (wanted && !display.frame) enlist(display)
      settle(display, awake && playing.includes(index))
    })
  }
  const schedule = () => {
    if (asked) return
    asked = true
    view.requestAnimationFrame(render)
  }
  const restart = () => {
    for (const display of displays) retire(display)
    fit()
    schedule()
  }
  const fit = () => {
    const wide = phone.matches ? PHONE_WIDTH : DESKTOP_WIDTH
    for (const { screen } of displays) screen.style.setProperty('--fit', String(screen.clientWidth / wide))
  }
  view.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== app.origin || !isDemoReady(event.data)) return
    const display = displays.find(({ frame }) => frame?.contentWindow === event.source)
    if (!display || display.ready) return
    display.ready = true
    display.playing = true
    display.box.classList.add('is-ready')
    if (still.matches) tell(display, { still: true })
    render()
  })
  view.addEventListener('scroll', schedule, { passive: true })
  view.addEventListener('resize', schedule)
  view.document.addEventListener('visibilitychange', schedule)
  phone.addEventListener('change', restart)
  still.addEventListener('change', restart)
  const sizes = new ResizeObserver(fit)
  for (const { screen } of displays) sizes.observe(screen)
  fit()
  whenIdle(view, () => {
    started = true
    schedule()
  })
}
