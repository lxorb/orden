export const loadOverview = () => import('./Overview.svelte')
function idle(work: () => void) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 4000 })
  else setTimeout(work, 1000)
}
export const wakeFaces = () =>
  import('./faces.svelte').then(() => {
    idle(() => void loadOverview())
  })
