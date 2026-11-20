export const loadOverview = () => import('./Overview.svelte')
function idle(work: () => void) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 4000 })
  else setTimeout(work, 1000)
}
function altAlone(event: KeyboardEvent) {
  if (event.key !== 'Alt') return
  removeEventListener('keyup', altAlone, true)
  void loadOverview()
  void import('./faces.svelte').then((one) => one.faces.read())
}
export const wakeFaces = () =>
  import('./faces.svelte').then(() => {
    addEventListener('keyup', altAlone, { capture: true, passive: true })
    idle(() => void loadOverview())
  })
