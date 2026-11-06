import { fitStep } from './stage'

export function fitSurface(surface: HTMLElement): number {
  const step = fitStep((wanted) => {
    surface.style.setProperty('--stage-fit', String(wanted))
    return surface.scrollHeight <= surface.clientHeight + 1
  })

  surface.style.setProperty('--stage-fit', String(step))
  return step
}
