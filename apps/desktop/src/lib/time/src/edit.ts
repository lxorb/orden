import { type Said, undoToast } from '../../undo-toast/src/api'
import { takesTime, type Write } from './schedule'
import { time } from './time.svelte'

export function edited(writes: readonly Write[], said: Said): void {
  const lost = takesTime(time.spans, writes, Date.now())
  const step = time.schedule(writes)
  if (step && lost) undoToast.offer(said, () => time.undoSchedule(step))
}
export function undone(redo: boolean): boolean {
  const done = redo ? time.redoSchedule() : time.undoSchedule()
  if (done) undoToast.dismiss()
  return done
}
