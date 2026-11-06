import { wallpaperCss } from '@orden/themes/wallpaper'
import { theme } from '../theme.svelte'
import { valueOf } from '../themes/settings'
import { coloursOf, fieldFloors } from './colours'
import { type Held, heldDark, heldWallpaper, type Scheme, WALLPAPER_THEME } from './held'
import { type Dials, picturesRule, wallpaperRule } from './look'
import { dialsOf, wallpaperSettings } from './settings'

const shown: Record<Scheme, Held | null | undefined> = { light: undefined, dark: undefined }

export function showPicture(scheme: Scheme, held: Held | null | undefined): void {
  shown[scheme] = held
}

function dials(): Dials {
  const values = Object.fromEntries(
    wallpaperSettings().map((one) => [
      one.id,
      valueOf(one, theme.values[one.id] ?? theme.keptFor(WALLPAPER_THEME, one.id)),
    ]),
  )
  return dialsOf(values)
}

export function wallpaperSheet(): string {
  const pictures = {
    light: shown.light === undefined ? heldWallpaper() : shown.light,
    dark: shown.dark === undefined ? heldDark() : shown.dark,
  }
  let rule: string
  try {
    rule = wallpaperRule(pictures, dials(), coloursOf(theme.accent), fieldFloors())
  } catch {
    rule = picturesRule(pictures)
  }
  return `${wallpaperCss}\n${rule}`
}
