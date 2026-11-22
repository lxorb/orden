import { askSheet } from '@orden/contracts'

class PdfAsk {
  open = $state(false)
  private answered: ((go: boolean) => void) | null = null
  ask(): Promise<boolean> {
    this.answered?.(false)
    this.open = true
    void askSheet('export')
    return new Promise((resolve) => (this.answered = resolve))
  }
  answer(go: boolean) {
    this.open = false
    this.answered?.(go)
    this.answered = null
  }
}
export const pdfAsk = new PdfAsk()
