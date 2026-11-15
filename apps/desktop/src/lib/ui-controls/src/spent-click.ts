const WITHIN = 700

let armed: (() => void) | null = null

export function spendClick(press: { pointerType: string }, any = false): void {
  if ((press.pointerType === 'mouse' && !any) || armed) return

  const spend = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    done()
  }
  const timer = setTimeout(() => done(), WITHIN)
  const done = () => {
    clearTimeout(timer)
    window.removeEventListener('click', spend, true)
    window.removeEventListener('auxclick', spend, true)
    window.removeEventListener('pointerdown', done, true)
    armed = null
  }

  window.addEventListener('click', spend, true)
  window.addEventListener('auxclick', spend, true)
  window.addEventListener('pointerdown', done, true)
  armed = done
}
