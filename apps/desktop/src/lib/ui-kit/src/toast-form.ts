export interface ToastAction {
  label: string
  run: () => void
  look?: 'strong' | 'link' | 'quiet' | 'quieter'
}
type ToastForm = 'desktop' | 'ios' | 'android'
const APPLE = /iPhone|iPad|iPod/
export function toastForm(device: 'phone' | 'tablet' | 'desktop', os: string, agent: string): ToastForm {
  if (device !== 'phone') return 'desktop'
  return os === 'ios' || (!os && APPLE.test(agent)) ? 'ios' : 'android'
}
const SWIPED = 56
export function swipedAway(form: ToastForm, dx: number, dy: number): boolean {
  if (form === 'ios') return dy <= -SWIPED
  if (form === 'android') return Math.abs(dx) >= SWIPED && Math.abs(dx) > Math.abs(dy)
  return false
}
