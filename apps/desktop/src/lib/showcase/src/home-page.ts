import '@fontsource-variable/geist'
import './home.css'
import { DEMO_PHONE_SRC, DEMO_SRC, isDemoReady } from './demo-cue'
import {
  downloadFor,
  LATEST_RELEASE_API,
  originsAt,
  releaseAssets,
  type Origins,
  type ReleaseAsset,
  type Visitor,
} from './links'
import { cueOf, deviceTransform, frameOf, storyAt, type Track } from './story'

const PHONE = '(max-width: 719.98px)'
const STILL = '(prefers-reduced-motion: reduce)'
const LIGHT = '(prefers-color-scheme: light)'
const DESKTOP_SIZE = [1280, 800] as const
const PHONE_SIZE = [390, 844] as const
interface Agent {
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> }
}
interface Page {
  hero: HTMLElement
  stage: HTMLElement
  device: HTMLElement
  screen: HTMLElement
  demo: HTMLIFrameElement
  captions: HTMLElement[]
  coda: HTMLElement
  chapters: HTMLElement[]
}
function pageIn(doc: Document): Page | null {
  const one = (selector: string) => doc.querySelector<HTMLElement>(selector)
  const hero = one('.hero')
  const stage = one('.stage')
  const device = one('.device')
  const screen = one('.screen')
  const demo = doc.querySelector<HTMLIFrameElement>('iframe.demo')
  const coda = one('.coda-actions')
  const captions = [...doc.querySelectorAll<HTMLElement>('.caption')]
  const chapters = [...doc.querySelectorAll<HTMLElement>('.chapter')]
  if (!hero || !stage || !device || !screen || !demo || !coda || chapters.length === 0) return null
  return { hero, stage, device, screen, demo, captions, coda, chapters }
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
export function showHome(view: Window) {
  const origins = originsAt(view.location)
  followTheme(view)
  offerDownload(view, origins)
  const page = pageIn(view.document)
  if (!page) return
  const phone = view.matchMedia(PHONE)
  const still = view.matchMedia(STILL)
  let track: Track = { rise: 1, span: 1 }
  let drop = 0
  let ready = false
  let asked = false
  let wanted = false
  const render = () => {
    asked = false
    const point = storyAt(view.scrollY, track)
    const frame = frameOf(point, still.matches)
    page.device.style.transform = deviceTransform(frame, drop)
    page.hero.style.opacity = String(frame.hero)
    page.captions.forEach((caption, index) => {
      caption.style.opacity = String(frame.captions[index] ?? 0)
    })
    page.coda.style.opacity = String(frame.close)
    const shut = frame.close < 0.5
    if (page.coda.inert !== shut) page.coda.inert = shut
    const seen = frame.close > 0 ? 'visible' : 'hidden'
    if (page.coda.style.visibility !== seen) page.coda.style.visibility = seen
    if (ready) page.demo.contentWindow?.postMessage(cueOf(point, still.matches), origins.app)
  }
  const schedule = () => {
    if (asked) return
    asked = true
    view.requestAnimationFrame(render)
  }
  const measure = () => {
    const first = page.chapters[0]
    const rise = (first?.getBoundingClientRect().top ?? 0) + view.scrollY
    track = { rise, span: first?.offsetHeight ?? 1 }
    const height = page.stage.offsetHeight
    drop = Math.max(0, height * (phone.matches ? 0.7 : 0.74) - page.device.offsetTop)
    const [wide, tall] = phone.matches ? PHONE_SIZE : DESKTOP_SIZE
    const fit = Math.max(page.screen.clientWidth / wide, page.screen.clientHeight / tall)
    page.screen.style.setProperty('--fit', String(fit))
    render()
  }
  const load = () => {
    wanted = true
    ready = false
    page.device.classList.remove('is-ready')
    page.demo.src = origins.app + (phone.matches ? DEMO_PHONE_SRC : DEMO_SRC)
  }
  view.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== origins.app || event.source !== page.demo.contentWindow) return
    if (!isDemoReady(event.data)) return
    ready = true
    page.device.classList.add('is-ready')
    render()
  })
  view.addEventListener('scroll', schedule, { passive: true })
  phone.addEventListener('change', () => {
    if (wanted) load()
    measure()
  })
  still.addEventListener('change', schedule)
  new ResizeObserver(measure).observe(page.stage)
  measure()
  whenIdle(view, load)
}
