import { fromPage, matchesCombination, type Platform } from '../../ui-kit/src/api'

export interface Bindings {
  readonly platform: Platform
  pressed(id: string, event: KeyboardEvent): boolean
}

export type BarKey =
  | { to: 'address' }
  | { to: 'step'; step: 'reload' | 'fresh' }
  | { to: 'tab'; at: number | 'last' }
  | { to: 'zoom'; step: ZoomStep }
  | { to: 'history' }
  | { to: 'clear' }

export type ZoomStep = 'in' | 'out' | 'reset'

export function barKey(event: KeyboardEvent, keys: Bindings): BarKey | null {
  const either = (id: string) => keys.pressed(id, event) || keys.pressed(`${id}.alt`, event)

  const f6 = event.key === 'F6' && !event.ctrlKey && !event.shiftKey && !event.altKey
  if (either('web.address') || (f6 && fromPage(event))) return { to: 'address' }

  if (either('web.history')) return { to: 'history' }
  if (either('web.clear-data')) return { to: 'clear' }

  if (either('web.reload')) return { to: 'step', step: 'reload' }
  if (either('web.fresh')) return { to: 'step', step: 'fresh' }

  if (keys.pressed('app.zoom-in', event) || plus(event, keys.platform)) {
    return { to: 'zoom', step: 'in' }
  }
  if (keys.pressed('app.zoom-out', event)) return { to: 'zoom', step: 'out' }
  if (keys.pressed('app.zoom-reset', event)) return { to: 'zoom', step: 'reset' }

  for (let index = 0; index < 9; index++) {
    if (matchesCombination(`Mod-${index + 1}`, event, keys.platform)) {
      return { to: 'tab', at: index === 8 ? 'last' : index }
    }
  }

  return null
}

function plus(event: KeyboardEvent, platform: Platform): boolean {
  const mod = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return mod && !event.altKey && event.key === '+'
}

export function stops(event: KeyboardEvent, loading: boolean, keys: Bindings): boolean {
  return loading && !event.defaultPrevented && keys.pressed('web.stop', event)
}
