import { keep, invoke, isDesktop } from '../../platform/src/api'

const KEY = 'orden:ground'

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

    if (isDesktop) {
      void invoke('remember_ground', { colour: ground, paint: paintOf(ground) }).catch(
        () => undefined,
      )
    }
  })
}

function paintOf(ground: string): string {
  if (!ground.startsWith('rgba(')) return ground
  const probe = document.createElement('div')
  probe.style.background = 'var(--bg)'
  document.body.append(probe)
  const paint = getComputedStyle(probe).backgroundColor.trim()
  probe.remove()
  return paint
}
