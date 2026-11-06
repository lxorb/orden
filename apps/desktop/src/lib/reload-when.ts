import { overlays } from './overlays'
import { keep, storedText } from './stored'
import { isNative } from './tauri'
import { afterQuiet } from './timing'

const HANDS_OFF = 3000

const RELOADED_FOR = 'nib:reloaded-for'

const HANDS = ['keydown', 'pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'wheel']

interface Missing {
  held: () => boolean
  settled: () => Promise<boolean>
  offer: () => void
}

export function entryOf(markup: string): string | null {
  for (const [tag] of markup.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*["']?module\b/i.test(tag)) continue
    const source = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]
    if (source) return source
  }

  return null
}

export function verdict(
  running: string | null,
  served: string,
  reloadedFor: string | null,
): 'reload' | 'offer' {
  return served !== running && served !== reloadedFor ? 'reload' : 'offer'
}

export async function answer(page: Missing): Promise<boolean> {
  const served = isNative || __EVEN_PLUGIN__ ? entryRunning() : await entryServed()
  if (served === null) return false

  if (verdict(entryRunning(), served, storedText(RELOADED_FOR)) === 'offer') page.offer()
  else {
    do {
      await handsOff(page)
    } while (!(await page.settled()))

    keep(RELOADED_FOR, served)
    location.reload()
  }

  return true
}

function inField(): boolean {
  const field = document.activeElement
  if (!field || field.closest('.cm-editor')) return false

  return field.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

function handsOff(page: Missing): Promise<void> {
  return new Promise((done) => {
    const look = afterQuiet(() => {
      if (page.held() || overlays.depth > 0 || inField()) look()
      else {
        stop()
        done()
      }
    }, HANDS_OFF)
    const touched = () => look()
    const hidden = () => {
      if (document.hidden) look.flush()
    }
    const stop = () => {
      look.cancel()
      for (const hand of HANDS) removeEventListener(hand, touched, true)
      document.removeEventListener('visibilitychange', hidden)
    }

    for (const hand of HANDS) addEventListener(hand, touched, { capture: true, passive: true })
    document.addEventListener('visibilitychange', hidden)
    look()
    hidden()
  })
}

function entryRunning(): string | null {
  return document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null
}

async function entryServed(): Promise<string | null> {
  try {
    const page = await fetch('/', { cache: 'no-store', headers: { accept: 'text/html' } })
    return page.ok ? entryOf(await page.text()) : null
  } catch {
    return null
  }
}
