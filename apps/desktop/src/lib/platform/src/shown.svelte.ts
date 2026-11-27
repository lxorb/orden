import { getContext, setContext, untrack } from 'svelte'

const SHOWN = Symbol('tab shown')
export function giveTabShown(shown: () => boolean): void {
  setContext(SHOWN, shown)
}
function tabShown(): () => boolean {
  return getContext<(() => boolean) | undefined>(SHOWN) ?? (() => true)
}
export function whileShown(every: number | (() => number), run: () => void): void {
  const shown = tabShown()
  $effect(() => {
    if (!shown()) return
    const timer = setInterval(run, typeof every === 'number' ? every : every())
    untrack(run)
    return () => clearInterval(timer)
  })
}
