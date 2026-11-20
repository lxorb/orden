import { invoke } from '../../platform/src/api'
import type { Page, pages as Pages } from './pages.svelte'

type Held = typeof Pages
const COVER_HIDES = 5000
const STILL_LOOKS = 100
const PICTURE_EVERY = 200
function stirring(): boolean {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return false
  return document.getAnimations().some((one) => one.playState === 'running')
}
export async function decoded(picture: string): Promise<void> {
  if (typeof Image !== 'function') return
  const one = new Image()
  one.src = picture
  await one.decode().catch(() => undefined)
}
export async function keepFresh(pages: Held, tabId: string, page: Page, going: () => boolean): Promise<void> {
  const watch = {}
  page.watching = watch
  await invoke('web_watch_drawing', { tab: tabId, on: true, picture: true }).catch(() => undefined)
  const until = Date.now() + COVER_HIDES
  const watched = () => going() && page.live && pages.peek(tabId) === page && page.watching === watch
  while (Date.now() < until && watched()) await new Promise<void>((go) => setTimeout(go, STILL_LOOKS))
  if (page.watching !== watch) return
  page.watching = null
  await invoke('web_watch_drawing', { tab: tabId, on: false }).catch(() => undefined)
}
export function drew(pages: Held, tabId: string, picture: string | null): void {
  const page = pages.peek(tabId)
  const watch = page?.watching
  if (!page || !watch || picture === null || stirring()) return
  if (Date.now() - page.shotAt < PICTURE_EVERY) return
  const { url, shotAt } = page
  void decoded(picture).then(() => {
    if (page.watching !== watch || page.url !== url || page.shotAt !== shotAt) return
    page.shot = picture
    page.shotAt = Date.now()
  })
}
export function glance(pages: Held, tabId: string): void {
  const page = pages.peek(tabId)
  if (!page?.live || !page.shown || page.watching) return
  if (page.shot && !page.stirred) return
  page.stirred = false
  void pages.retake(tabId, page)
}
function hexOf(colour: string): string | null {
  const parts = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour)
  if (!parts) return null
  return `#${parts
    .slice(1, 4)
    .map((one) => Number(one).toString(16).padStart(2, '0'))
    .join('')}`
}
let ground: string | null = null
export function groundNow(): string | null {
  if (typeof document === 'undefined') return null
  try {
    const probe = document.createElement('i')
    probe.style.background = 'var(--bg)'
    document.body.append(probe)
    const said = hexOf(getComputedStyle(probe).backgroundColor)
    probe.remove()
    ground = said ?? ground
    return said
  } catch {
    return null
  }
}
export function watchGround(): void {
  if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return
  let asked = false
  const looked = () => {
    asked = false
    const was = ground
    const now = groundNow()
    if (now && now !== was) void invoke('web_ground', { ground: now }).catch(() => undefined)
  }
  const watching = new MutationObserver(() => {
    if (asked) return
    asked = true
    requestAnimationFrame(looked)
  })
  for (const one of [document.documentElement, document.body]) watching.observe(one, { attributes: true })
}
