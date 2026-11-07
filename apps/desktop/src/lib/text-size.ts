import { modes } from './modes.svelte'
import { platform } from './tauri'

export function sizeStepFor(
  event: { ctrlKey: boolean; deltaY: number; defaultPrevented: boolean },
  overNote: boolean,
): number {
  if (!event.ctrlKey || event.defaultPrevented || !event.deltaY || !overNote) return 0

  return event.deltaY < 0 ? 1 : -1
}

function overNote(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.orden-write')
}

export function watchTextSize(): () => void {
  const pinches = platform() === 'windows'
  const onWheel = (event: WheelEvent) => {
    const step = sizeStepFor(event, overNote(event.target))
    if (!step) {
      if (pinches && event.ctrlKey) event.preventDefault()
      return
    }

    event.preventDefault()
    modes.stepZoom(step)
  }

  window.addEventListener('wheel', onWheel, { passive: false })
  return () => window.removeEventListener('wheel', onWheel)
}
