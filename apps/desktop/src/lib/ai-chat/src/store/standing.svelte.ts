import { forget, heardElsewhere, keep, storedText } from '../../../platform/src/api'

const KEY = 'orden:ai-standing-instructions'
class Standing {
  text = $state(storedText(KEY) ?? '')
  set(text: string): void {
    this.text = text.trim() ? text : ''
    if (this.text) keep(KEY, this.text)
    else forget(KEY)
  }
}
export const instructionsKept = new Standing()
heardElsewhere([KEY], () => {
  instructionsKept.text = storedText(KEY) ?? ''
})
export function standingInstructions(text = instructionsKept.text): string {
  return text.trim() ? `The reader's standing instructions:\n${text.trim()}` : ''
}
