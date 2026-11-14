import type { Scheme } from '@orden/contracts'
import { accentColour } from '../../../accents'
import { chooseFiles, PICTURES } from '../../../choose-files'
import { fileBytes } from '../../../bytes'
import { message } from '../../../message'
import { settings } from '../../../settings.svelte'
import { forget, keepJson } from '../../../stored'
import { theme } from '../../../theme/src/api'
import { afterQuiet, onceAFrame } from '../../../timing'
import {
  DARK_KEY,
  type Held,
  heldDark,
  heldWallpaper,
  WALLPAPER_KEY,
  WALLPAPER_THEME,
} from './held'
import { type Copy, forgetSource, keepSource, keptSource } from './kept'
import { sharpBelow, sharpSide } from './pixels'
import { copyOf, decode, type Drawable, made, sharp, type Tone, toneKey } from './render'
import { toneOf } from './settings'
import { showPicture } from './sheet'

type Slot = 'main' | 'dark'
const SLOTS = ['main', 'dark'] as const

const KEYS: Record<Slot, string> = { main: WALLPAPER_KEY, dark: DARK_KEY }
const COPIES: Record<Slot, Copy> = { main: 'source', dark: 'source-dark' }
const SAID: Record<Slot, Scheme> = { main: 'light', dark: 'dark' }

const MOVING = 1280
const LARGEST_COPY = 3200

function screenSide(): number {
  return Math.max(screen.width, screen.height, window.innerWidth, window.innerHeight)
}

function devicePixels(): number {
  return Math.min(LARGEST_COPY, Math.round(screenSide() * (window.devicePixelRatio || 1)))
}

function sharpLongest(blur: number, kept: boolean): number {
  const side = sharpSide(blur, screenSide(), devicePixels())
  return kept ? side : Math.min(MOVING, side)
}

function blurDial(): number {
  return Number(theme.values.blur ?? 28)
}

function toneDial(): Tone {
  const asked = toneOf(theme.values, theme.accent)
  return { ...asked, colour: accentColour(asked.colour, 'dark') }
}

class Wallpaper {
  held = $state<Record<Slot, Held | null>>({ main: heldWallpaper(), dark: heldDark() })

  private sources: Record<Slot, Drawable | null> = { main: null, dark: null }
  private asked = 0
  private sharpAddress: string | null = null

  private readonly keepLater = afterQuiet(() => {
    if (theme.previewing) {
      this.keepLater()
      return
    }
    void this.remake(true).then(() => {
      for (const slot of SLOTS) this.write(slot)
      theme.rewear(WALLPAPER_THEME)
    })
  }, 400)

  of(scheme: Scheme): Held | null {
    return scheme === 'dark' ? (this.held.dark ?? this.held.main) : this.held.main
  }

  owns(scheme: Scheme): boolean {
    return this.held[scheme === 'dark' ? 'dark' : 'main'] !== null
  }

  private wornBy(scheme: Scheme): Slot {
    return scheme === 'dark' && this.held.dark ? 'dark' : 'main'
  }

  async take(picture: Blob, scheme: Scheme = 'light'): Promise<boolean> {
    const slot: Slot = scheme === 'dark' ? 'dark' : 'main'
    const asking = ++this.asked
    try {
      const original = await decode(picture)
      const ratio = window.devicePixelRatio || 1
      const size: [number, number] = [
        Math.round(original.width / ratio),
        Math.round(original.height / ratio),
      ]
      const copy = await copyOf(original)
      const source = await decode(copy)
      if (asking !== this.asked) return false

      this.sources[slot] = source
      void keepSource(copy, COPIES[slot])
      await this.make(slot, source, [0.5, 0.5], size, true)
      await this.wearSharp()
      this.write(slot)
      theme.rewear(WALLPAPER_THEME)
      if (theme.id !== WALLPAPER_THEME) theme.select(WALLPAPER_THEME)
      return true
    } catch (error) {
      settings.error = message(error, 'That picture could not be read.')
      return false
    }
  }

  async choose(scheme: Scheme = 'light'): Promise<void> {
    const [file] = await chooseFiles({ accept: PICTURES })
    if (file) await this.take(file, scheme)
  }

  async takeFrom(path: string): Promise<void> {
    const bytes = await fileBytes(path).catch(() => new Uint8Array())
    await this.take(new Blob([bytes as BlobPart]))
  }

  clear(scheme: Scheme = 'light'): void {
    const slot: Slot = scheme === 'dark' ? 'dark' : 'main'
    this.asked++
    this.sources[slot] = null
    this.held = { ...this.held, [slot]: null }
    this.keepLater.cancel()
    forget(KEYS[slot])
    void forgetSource(COPIES[slot])
    showPicture(SAID[slot], undefined)
    void this.wearSharp()
    theme.rewear(WALLPAPER_THEME)
  }

  place(scheme: Scheme, x: number, y: number, kept: boolean): void {
    const slot = this.wornBy(scheme)
    const held = this.held[slot]
    if (!held) return

    const focus: [number, number] = [clamp(x), clamp(y)]
    const next = { ...held, focus }
    this.held = { ...this.held, [slot]: next }
    showPicture(SAID[slot], next)
    theme.rewear(WALLPAPER_THEME, false)
    if (kept) {
      this.write(slot)
      theme.rewear(WALLPAPER_THEME)
    }
  }

  async wake(): Promise<void> {
    const stale = SLOTS.some((slot) => {
      const held = this.held[slot]
      return held !== null && (held.span === undefined || held.tone !== toneKey(toneDial()))
    })
    if (stale) {
      await this.remake(true)
      for (const slot of SLOTS) this.write(slot)
      theme.rewear(WALLPAPER_THEME)
      return
    }
    await this.wearSharp()
  }

  async redial(): Promise<void> {
    await this.remake(false)
    theme.rewear(WALLPAPER_THEME, false)
    this.keepLater()
  }

  resheet(): void {
    theme.rewear(WALLPAPER_THEME, false)
    this.keepLater()
  }

  private async remake(kept: boolean): Promise<void> {
    const asking = ++this.asked
    const blur = blurDial()
    const tone = toneKey(toneDial())

    for (const slot of SLOTS) {
      const held = this.held[slot]
      if (!held) continue
      const sharpened = blur < sharpBelow(screenSide())
      const current = held.blur === blur && held.tone === tone && held.span !== undefined
      if (current && !(kept && sharpened)) continue

      const source = await this.sourceOf(slot)
      if (!source || asking !== this.asked) return
      await this.make(slot, source, held.focus, held.size ?? [source.width, source.height], kept)
      if (asking !== this.asked) return
    }
    await this.wearSharp(kept)
  }

  private async sourceOf(slot: Slot): Promise<Drawable | null> {
    const held = this.sources[slot]
    if (held) return held
    const kept = await keptSource(COPIES[slot])
    const source = kept ? await decode(kept).catch(() => null) : null
    if (source) this.sources[slot] = source
    return source
  }

  private async make(
    slot: Slot,
    source: Drawable,
    focus: [number, number],
    size: [number, number],
    kept: boolean,
  ): Promise<void> {
    const blur = blurDial()
    const tone = toneDial()
    const side = screenSide()
    const least = sharpBelow(side)
    let held = made(source, Math.max(blur, least), tone, side, focus, size)
    held = { ...held, blur }

    if (blur < least) {
      const copy = await sharp(source, blur, tone, side, sharpLongest(blur, kept))
      held = { ...held, span: copy.span, mean: copy.mean }
      this.sharpened[slot] = copy.picture
    } else {
      this.sharpened[slot] = null
    }

    this.held = { ...this.held, [slot]: held }
    showPicture(SAID[slot], held)
  }

  private sharpened: Record<Slot, Blob | null> = { main: null, dark: null }

  private async wearSharp(kept = true): Promise<void> {
    const slot = this.wornBy(theme.current)
    const held = this.held[slot]
    let copy = this.sharpened[slot]
    if (held && held.blur < sharpBelow(screenSide()) && copy === null) {
      const source = await this.sourceOf(slot)
      if (source) {
        const made = await sharp(
          source,
          held.blur,
          toneDial(),
          screenSide(),
          sharpLongest(held.blur, kept),
        )
        copy = made.picture
        this.sharpened[slot] = copy
      }
    }

    const wanted = held && held.blur < sharpBelow(screenSide()) ? copy : null
    const root = document.documentElement.style
    if (this.sharpAddress) URL.revokeObjectURL(this.sharpAddress)
    this.sharpAddress = wanted ? URL.createObjectURL(wanted) : null
    if (this.sharpAddress) root.setProperty('--wallpaper-sharp', `url("${this.sharpAddress}")`)
    else root.removeProperty('--wallpaper-sharp')
  }

  sleep(): void {
    if (this.sharpAddress) URL.revokeObjectURL(this.sharpAddress)
    this.sharpAddress = null
    document.documentElement.style.removeProperty('--wallpaper-sharp')
  }

  rescheme(): void {
    void this.wearSharp()
  }

  private write(slot: Slot): void {
    const held = this.held[slot]
    if (!held) return
    if (keepJson(KEYS[slot], held)) showPicture(SAID[slot], undefined)
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export const wallpaper = new Wallpaper()

$effect.root(() => {
  let making = false
  let again = false

  const next = () => {
    if (making) {
      again = true
      return
    }
    making = true
    void wallpaper.redial().finally(() => {
      making = false
      if (!again) return
      again = false
      requestAnimationFrame(next)
    })
  }
  const sheet = onceAFrame(() => wallpaper.resheet())

  const following = () =>
    theme.id === WALLPAPER_THEME && theme.settings.some((one) => one.id === 'blur')
  const changed = () => {
    let last: string | null = null
    return (now: string) => {
      const was = last
      last = now
      return was !== null && was !== now
    }
  }
  const baked = changed()
  const said = changed()
  const side = changed()

  $effect(() => {
    if (!following()) return
    if (baked(`${blurDial()} ${toneKey(toneDial())}`)) next()
  })

  $effect(() => {
    if (!following()) return
    const { grain, fit, empty, content } = theme.values
    if (said(JSON.stringify([grain, fit, empty, content, theme.accent]))) sheet()
  })

  $effect(() => {
    if (theme.id !== WALLPAPER_THEME) {
      wallpaper.sleep()
      return
    }
    if (side(theme.current)) wallpaper.rescheme()
  })
})
