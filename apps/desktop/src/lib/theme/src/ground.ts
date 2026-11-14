import { keep, storedText, invoke, isDesktop } from '../../platform/src/api'

const KEY = 'orden:ground'

const NOTHING = 'rgba(0, 0, 0, 0)'

export const MATERIAL_KEY = 'orden:material'

export function stoodOnNothing(): boolean {
  return storedText(KEY) === NOTHING
}

export function groundUnknown(): boolean {
  return storedText(KEY) === null
}

export function standAsBefore(): void {
  const was = storedText(MATERIAL_KEY)
  if (was && stoodOnNothing()) document.documentElement.dataset.translucent = was
}

let asked = false

export function rememberGround(): void {
  if (asked || typeof requestAnimationFrame !== 'function') return
  asked = true

  requestAnimationFrame(() => {
    asked = false

    document.documentElement.style.removeProperty('background')

    const ground = getComputedStyle(document.body).backgroundColor.trim()
    if (!ground) return

    keep(KEY, ground)

    if (isDesktop) void invoke('remember_ground', { colour: ground }).catch(() => undefined)
  })
}
